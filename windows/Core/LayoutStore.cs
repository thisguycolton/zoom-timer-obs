namespace ZoomTimerBridge;

/// <summary>Persists the canvas layout made in editor.html, plus uploaded images, under
/// %APPDATA%\ZoomTimerBridge\ (layout.json and assets\). Same files as the macOS helper's Application Support folder.</summary>
public sealed class LayoutStore
{
    readonly string directory;

    public LayoutStore(string? directory = null)
    {
        this.directory = directory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ZoomTimerBridge");
    }

    string LayoutPath => Path.Combine(directory, "layout.json");
    public string AssetsDirectory => Path.Combine(directory, "assets");

    public byte[]? Load() => File.Exists(LayoutPath) ? File.ReadAllBytes(LayoutPath) : null;

    public void Save(byte[] data)
    {
        Directory.CreateDirectory(directory);
        var temp = LayoutPath + ".tmp";
        File.WriteAllBytes(temp, data);
        File.Move(temp, LayoutPath, overwrite: true);
    }

    /// <summary>Stores an uploaded image and returns the path it is served at.</summary>
    public string SaveAsset(byte[] data, string contentType)
    {
        var ext = contentType.Split(';')[0].Trim().ToLowerInvariant() switch
        {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/svg+xml" => "svg",
            _ => throw new NotSupportedException("Unsupported image type"),
        };
        Directory.CreateDirectory(AssetsDirectory);
        var name = Guid.NewGuid().ToString("D") + "." + ext;
        File.WriteAllBytes(Path.Combine(AssetsDirectory, name), data);
        return "/assets/" + name;
    }
}
