$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class OnniPrivateFileReader {
    const uint GENERIC_READ = 0x80000000;
    const uint FILE_SHARE_ALL = 0x00000007;
    const uint OPEN_EXISTING = 3;
    const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    const uint FILE_TYPE_DISK = 1;

    [StructLayout(LayoutKind.Sequential)]
    struct FileTime { public uint Low, High; }
    [StructLayout(LayoutKind.Sequential)]
    struct FileInformation {
        public uint Attributes;
        public FileTime CreationTime, LastAccessTime, LastWriteTime;
        public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint GetFileType(SafeFileHandle handle);

    static string ExtendedPath(string path) {
        if (path.StartsWith(@"\\?\", StringComparison.Ordinal)) return path;
        if (path.StartsWith(@"\\", StringComparison.Ordinal)) return @"\\?\UNC\" + path.Substring(2);
        if (path.Length >= 3 && path[1] == ':' && (path[2] == '\\' || path[2] == '/'))
            return @"\\?\" + path.Replace('/', '\\');
        return ExtendedPath(System.IO.Path.GetFullPath(path));
    }

    static Tuple<int, byte[]> Read(string path, int maxBytes) {
        if (maxBytes < 0 || maxBytes > 1048576) return Tuple.Create(1, new byte[0]);
        using (SafeFileHandle handle = CreateFileW(ExtendedPath(path), GENERIC_READ, FILE_SHARE_ALL,
            IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero)) {
            if (handle.IsInvalid) {
                int error = Marshal.GetLastWin32Error();
                return Tuple.Create(error == 2 || error == 3 ? 2 : 1, new byte[0]);
            }
            FileInformation info;
            if (!GetFileInformationByHandle(handle, out info) || GetFileType(handle) != FILE_TYPE_DISK)
                return Tuple.Create(1, new byte[0]);
            if ((info.Attributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)) != 0)
                return Tuple.Create(3, new byte[0]);
            if ((((ulong)info.FileSizeHigh << 32) | info.FileSizeLow) > (ulong)maxBytes)
                return Tuple.Create(4, new byte[0]);
            using (FileStream input = new FileStream(handle, FileAccess.Read))
            using (MemoryStream buffered = new MemoryStream()) {
                byte[] chunk = new byte[8192];
                int count;
                while ((count = input.Read(chunk, 0, chunk.Length)) != 0) {
                    if (buffered.Length + count > maxBytes) return Tuple.Create(4, new byte[0]);
                    buffered.Write(chunk, 0, count);
                }
                return Tuple.Create(0, buffered.ToArray());
            }
        }
    }

    public static void Serve() {
        string line;
        while ((line = Console.ReadLine()) != null) {
            string[] fields = line.Split('\t');
            int id, maxBytes;
            int status = 1;
            byte[] bytes = new byte[0];
            if (fields.Length == 3 && Int32.TryParse(fields[0], out id) &&
                Int32.TryParse(fields[1], out maxBytes) && id > 0 && maxBytes >= 0 && maxBytes <= 1048576) {
                try {
                    string path = Encoding.UTF8.GetString(Convert.FromBase64String(fields[2]));
                    Tuple<int, byte[]> result = Read(path, maxBytes);
                    status = result.Item1;
                    bytes = result.Item2;
                } catch { status = 1; }
                string response = id.ToString() + "\t" + status.ToString() + "\t" + Convert.ToBase64String(bytes) + "\n";
                Console.Out.Write(response);
                Console.Out.Flush();
            } else {
                return;
            }
        }
    }
}
'@ -Language CSharp
  [OnniPrivateFileReader]::Serve()
} catch {
  exit 1
}
