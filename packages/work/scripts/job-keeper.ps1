# The engine's Windows Job Object keeper (C-05/C-06).
#
# One resident process per engine. Jobs created here are kill-on-close, so every process assigned
# to one dies when this keeper dies -- and this keeper dies when its stdin reaches EOF, which is
# what the OS does to the pipe the moment the engine goes away, including a hard `taskkill /F`.
#
# Wire protocol, one command per line on stdin:
#   <seq> assign <key> <pid>   put pid under job <key> (created on first use)
#   <seq> terminate <key>      TerminateJobObject on <key>
#   <seq> exit                 terminate everything and stop
# Replies, one per line on stdout: `<seq> ok` or `<seq> err <message>`, after a single `ready`.
#
# ASCII only: PowerShell 5.1 decodes a BOM-less .ps1 with the ANSI code page, and the console code
# page mangles anything else.

$ErrorActionPreference = 'Stop'

$keeperSource = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class OnniJobKeeper {
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    const int JobObjectExtendedLimitInformation = 9;
    const uint PROCESS_SET_QUOTA = 0x0100;
    const uint PROCESS_TERMINATE = 0x0001;

    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimitInformation {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimitInformation {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    static readonly Dictionary<string, IntPtr> Jobs = new Dictionary<string, IntPtr>(StringComparer.Ordinal);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int informationClass, ref ExtendedLimitInformation information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    static IntPtr Create() {
        IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObjectW failed");
        ExtendedLimitInformation limits = new ExtendedLimitInformation();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimitInformation)))) {
            int error = Marshal.GetLastWin32Error();
            CloseHandle(job);
            throw new Win32Exception(error, "SetInformationJobObject failed");
        }
        return job;
    }

    static IntPtr JobFor(string key) {
        IntPtr job;
        if (!Jobs.TryGetValue(key, out job)) {
            job = Create();
            Jobs.Add(key, job);
        }
        return job;
    }

    public static void Assign(string key, int processId) {
        IntPtr job = JobFor(key);
        IntPtr process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, processId);
        // A pid that already exited between spawn and assign is the caller's race, not ours to
        // crash on: report it and keep serving.
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess failed");
        try {
            if (!AssignProcessToJobObject(job, process))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject failed");
        } finally {
            CloseHandle(process);
        }
    }

    public static void Terminate(string key) {
        IntPtr job;
        if (Jobs.TryGetValue(key, out job) && !TerminateJobObject(job, 1))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "TerminateJobObject failed");
    }

    public static void TerminateAll() {
        foreach (IntPtr job in Jobs.Values) TerminateJobObject(job, 1);
        foreach (IntPtr job in Jobs.Values) CloseHandle(job);
        Jobs.Clear();
    }
}
'@

try {
  Add-Type -TypeDefinition $keeperSource -Language CSharp
} catch {
  [Console]::Error.WriteLine("onni-job-keeper: $($_.Exception.Message)")
  exit 125
}

function Write-Line([string]$text) {
  try {
    [Console]::Out.WriteLine($text)
    [Console]::Out.Flush()
  } catch {
    # The engine is gone; the EOF path below still cleans up.
  }
}

Write-Line 'ready'

while ($true) {
  $line = $null
  try {
    $line = [Console]::In.ReadLine()
  } catch {
    $line = $null
  }
  if ($null -eq $line) { break }

  $parts = $line.Trim() -split '\s+'
  if ($parts.Count -lt 2) { continue }
  $seq = $parts[0]
  $command = $parts[1]
  try {
    switch ($command) {
      'assign' {
        [OnniJobKeeper]::Assign($parts[2], [int]$parts[3])
        Write-Line "$seq ok"
      }
      'terminate' {
        [OnniJobKeeper]::Terminate($parts[2])
        Write-Line "$seq ok"
      }
      'exit' {
        [OnniJobKeeper]::TerminateAll()
        exit 0
      }
      default {
        Write-Line "$seq err unknown command $command"
      }
    }
  } catch {
    $message = $_.Exception.Message -replace "\r?\n", ' '
    Write-Line "$seq err $message"
  }
}

[OnniJobKeeper]::TerminateAll()
exit 0
