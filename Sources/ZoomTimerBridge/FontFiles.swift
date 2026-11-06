import CoreText
import Foundation

/// Serves installed fonts to the overlay as web fonts.
///
/// OBS's browser source doesn't reliably see fonts installed on the Mac by name, so the overlay links
/// GET /fontface/<family>.css, which declares an @font-face for each face of that family, pointing at
/// GET /fontfile/<PostScript name>.ttf. Each face is rebuilt as a single standalone font file from
/// its tables, which also works for faces inside .ttc collections (Helvetica Neue, Avenir Next, …).
enum FontFiles {
    /// @font-face rules for every installed face of `family`, or nil if no such family is installed.
    static func css(family: String) -> Data? {
        let query = CTFontDescriptorCreateWithAttributes([kCTFontFamilyNameAttribute as String: family] as CFDictionary)
        guard let faces = CTFontDescriptorCreateMatchingFontDescriptors(query, nil) as? [CTFontDescriptor], !faces.isEmpty
        else { return nil }
        var seen = Set<String>()
        var css = ""
        for face in faces {
            guard let ps = CTFontDescriptorCopyAttribute(face, kCTFontNameAttribute) as? String, !ps.hasPrefix("."),
                  let faceFamily = CTFontDescriptorCopyAttribute(face, kCTFontFamilyNameAttribute) as? String,
                  faceFamily.caseInsensitiveCompare(family) == .orderedSame
            else { continue }
            let traits = CTFontDescriptorCopyAttribute(face, kCTFontTraitsAttribute) as? [String: Any] ?? [:]
            let weight = cssWeight((traits[kCTFontWeightTrait as String] as? NSNumber)?.doubleValue ?? 0)
            let symbolic = (traits[kCTFontSymbolicTrait as String] as? NSNumber)?.uint32Value ?? 0
            let italic = symbolic & CTFontSymbolicTraits.traitItalic.rawValue != 0
            let key = "\(weight)-\(italic)"
            guard !seen.contains(key) else { continue } // first face wins for each weight/style
            seen.insert(key)
            let file = ps.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? ps
            css += "@font-face { font-family: \"\(cssEscape(family))\"; font-weight: \(weight); "
                + "font-style: \(italic ? "italic" : "normal"); font-display: block; "
                + "src: url(\"/fontfile/\(file).ttf\") format(\"opentype\"); }\n"
        }
        return css.isEmpty ? nil : Data(css.utf8)
    }

    /// The face with this PostScript name as a standalone OpenType file, or nil if it isn't installed.
    static func file(postScriptName name: String) -> Data? {
        let font = CTFontCreateWithName(name as CFString, 12, nil)
        // CTFontCreateWithName falls back to another font when the name is unknown.
        guard CTFontCopyPostScriptName(font) as String == name,
              let tagArray = CTFontCopyAvailableTables(font, CTFontTableOptions(rawValue: 0))
        else { return nil }
        var tables: [(tag: UInt32, data: Data)] = []
        for i in 0..<CFArrayGetCount(tagArray) {
            let tag = UInt32(truncatingIfNeeded: UInt(bitPattern: CFArrayGetValueAtIndex(tagArray, i)))
            if let data = CTFontCopyTable(font, tag, CTFontTableOptions(rawValue: 0)) as Data? {
                tables.append((tag, data))
            }
        }
        return buildSFNT(tables)
    }

    // MARK: - Helpers

    static let headTag: UInt32 = 0x6865_6164 // 'head'
    static let cffTag: UInt32 = 0x4346_4620  // 'CFF '

    /// Writes tables into one sfnt file (OpenType spec, "Organization of an OpenType Font").
    static func buildSFNT(_ input: [(tag: UInt32, data: Data)]) -> Data? {
        let tables = input.sorted { $0.tag < $1.tag }
        guard !tables.isEmpty, tables.count < 0xFFFF else { return nil }
        let isCFF = tables.contains { $0.tag == cffTag || $0.tag == 0x4346_4632 } // 'CFF ' or 'CFF2'
        var out = Data()
        func u16(_ v: Int) { out.append(UInt8(v >> 8 & 0xFF)); out.append(UInt8(v & 0xFF)) }
        func u32(_ v: UInt32) { u16(Int(v >> 16)); u16(Int(v & 0xFFFF)) }

        let n = tables.count
        var power = 1, log2 = 0
        while power * 2 <= n { power *= 2; log2 += 1 }
        u32(isCFF ? 0x4F54_544F : 0x0001_0000) // 'OTTO' or TrueType
        u16(n); u16(power * 16); u16(log2); u16(n * 16 - power * 16)

        var offset = 12 + 16 * n
        var bodies: [Data] = []
        var headOffset: Int?
        for table in tables {
            var data = table.data
            if table.tag == headTag, data.count >= 12 { data.replaceSubrange(8..<12, with: [0, 0, 0, 0]) }
            u32(table.tag); u32(checksum(data)); u32(UInt32(offset)); u32(UInt32(data.count))
            if table.tag == headTag { headOffset = offset }
            let padded = (data.count + 3) & ~3
            data.append(contentsOf: [UInt8](repeating: 0, count: padded - data.count))
            bodies.append(data)
            offset += padded
        }
        bodies.forEach { out.append($0) }
        if let headOffset, out.count >= headOffset + 12 {
            let adjust = 0xB1B0_AFBA &- checksum(out)
            out.replaceSubrange(headOffset + 8..<headOffset + 12,
                                with: [UInt8(adjust >> 24), UInt8(adjust >> 16 & 0xFF), UInt8(adjust >> 8 & 0xFF), UInt8(adjust & 0xFF)])
        }
        return out
    }

    static func checksum(_ data: Data) -> UInt32 {
        var sum: UInt32 = 0
        var word: UInt32 = 0
        var i = 0
        for byte in data {
            word = word << 8 | UInt32(byte)
            i += 1
            if i == 4 { sum = sum &+ word; word = 0; i = 0 }
        }
        if i > 0 { sum = sum &+ (word << (8 * UInt32(4 - i))) }
        return sum
    }

    /// Maps CoreText's weight trait (-1…1) to the nearest CSS weight.
    static func cssWeight(_ w: Double) -> Int {
        let scale: [(Double, Int)] = [(-0.8, 100), (-0.6, 200), (-0.4, 300), (0, 400), (0.23, 500), (0.3, 600), (0.4, 700), (0.56, 800), (0.62, 900)]
        return scale.min { abs($0.0 - w) < abs($1.0 - w) }!.1
    }

    static func cssEscape(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "").replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "\n", with: "")
    }
}
