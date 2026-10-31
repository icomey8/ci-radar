import AppKit
import CIRadarKit
import SwiftUI

extension Color {
  /// What the main content sits on: white in light mode, near-black in dark.
  static let paneBackground = Color(nsColor: .textBackgroundColor)
}

/// A faint glow of the repo's status from the top of the pane; nothing for a healthy repo.
struct StatusWash: View {
  let status: RepoStatus?

  var body: some View {
    if let status {
      LinearGradient(
        colors: [status.tint.opacity(0.1), .clear],
        startPoint: .top,
        endPoint: UnitPoint(x: 0.5, y: 0.35)
      )
      .ignoresSafeArea()
    }
  }
}
