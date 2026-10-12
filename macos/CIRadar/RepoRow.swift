import CIRadarKit
import SwiftUI

/// A sidebar row: `owner/name`, how fresh its data is, and one status icon.
struct RepoRow: View {
  let repo: Repo

  var body: some View {
    HStack {
      VStack(alignment: .leading, spacing: 2) {
        Text(repo.fullName)
          .font(.callout.weight(.medium))
          .lineLimit(1)
          .truncationMode(.middle)
        Group {
          if let latestDataAt = repo.latestDataAt {
            Text("latest data \(latestDataAt, format: .relative(presentation: .named))")
          } else {
            Text("not ingested yet")
          }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
      }
      Spacer()
      switch repo.status {
      case .broken:
        Image(systemName: "xmark.octagon.fill")
          .foregroundStyle(.red)
          .help("Broken jobs or tests")
      case .flaky:
        Image(systemName: "exclamationmark.triangle.fill")
          .foregroundStyle(.orange)
          .help("Flaky jobs or tests")
      case nil:
        EmptyView()
      }
    }
    .padding(.vertical, 2)
  }
}

#Preview {
  List {
    RepoRow(repo: Repo(id: 1, owner: "icomey8", name: "flaky-test", latestDataAt: .now.addingTimeInterval(-720), flakyCount: 4, brokenCount: 1))
    RepoRow(repo: Repo(id: 2, owner: "icomey8", name: "payments-service", latestDataAt: .now.addingTimeInterval(-3600), flakyCount: 2, brokenCount: 0))
    RepoRow(repo: Repo(id: 3, owner: "icomey8", name: "quiet-lib", latestDataAt: .now.addingTimeInterval(-7200), flakyCount: 0, brokenCount: 0))
    RepoRow(repo: Repo(id: 4, owner: "octo-org", name: "new-service", latestDataAt: nil, flakyCount: 0, brokenCount: 0))
  }
  .frame(width: 260)
}
