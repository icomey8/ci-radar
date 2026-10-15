// Prints the CGWindowID of a process's main window, waiting for it to appear. Used by screenshot.sh.
// Usage: swift window-id.swift <pid>
import CoreGraphics
import Foundation

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("window-id: \(message)\n".utf8))
  exit(1)
}

guard CommandLine.arguments.count >= 2, let pid = Int(CommandLine.arguments[1]) else {
  fail("usage: window-id.swift <pid>")
}
let timeout = 15.0

guard CGPreflightScreenCaptureAccess() else {
  fail(
    "Screen Recording isn't granted to the app running this script. Grant it in System Settings → "
      + "Privacy & Security → Screen & System Audio Recording, then restart that app.")
}

let deadline = Date.now.addingTimeInterval(timeout)
while Date.now < deadline {
  guard kill(pid_t(pid), 0) == 0 else { fail("pid \(pid) exited before showing a window") }
  let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []
  let mainWindow = windows.first { window in
    let bounds = window[kCGWindowBounds as String] as? [String: Double] ?? [:]
    return window[kCGWindowOwnerPID as String] as? Int == pid
      && window[kCGWindowLayer as String] as? Int == 0
      && (bounds["Width"] ?? 0) > 100 && (bounds["Height"] ?? 0) > 100
  }
  if let id = mainWindow?[kCGWindowNumber as String] as? Int {
    print(id)
    exit(0)
  }
  Thread.sleep(forTimeInterval: 0.2)
}
fail("no window from pid \(pid) within \(Int(timeout))s")
