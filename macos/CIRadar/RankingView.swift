import CIRadarKit
import SwiftUI

/// The detail pane: the selected repo's header, its numbered Flaky rows, then its Broken rows.
struct RankingView: View {
  let ranking: Ranking

  var body: some View {
    List {
      RankingHeader(ranking: ranking)
        .listRowSeparator(.hidden)
        .padding(.bottom, 4)

      Section {
        // Numbered in rank() order, which the API already applied. Never re-sort.
        // Rows are identified by value: rank() yields each job or test once, and the List needs
        // ids that are unique across both sections.
        ForEach(Array(ranking.flaky.enumerated()), id: \.element) { index, row in
          RankingRow(row: row, placement: .flaky(number: index + 1))
        }
      } header: {
        SectionHeader(title: "FLAKY · \(ranking.flaky.count)", status: .flaky)
      }

      if !ranking.broken.isEmpty {
        Section {
          ForEach(ranking.broken, id: \.self) { row in
            RankingRow(row: row, placement: .broken)
          }
        } header: {
          SectionHeader(title: "BROKEN · failing almost every run", status: .broken)
        }
      }
    }
    .listStyle(.inset)
    .alternatingRowBackgrounds(.disabled)
  }
}

/// `owner/name` over the window the ranking covers and how fresh its data is.
private struct RankingHeader: View {
  let ranking: Ranking

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(ranking.repo.fullName)
        .font(.title2.weight(.semibold))
        .lineLimit(1)
        .truncationMode(.middle)
      Group {
        if let latestDataAt = ranking.repo.latestDataAt {
          Text(
            "Last \(ranking.daysBack) days · latest data \(latestDataAt, format: .relative(presentation: .named))")
        } else {
          Text("Last \(ranking.daysBack) days · not ingested yet")
        }
      }
      .font(.callout)
      .foregroundStyle(.secondary)
    }
    .padding(.top, 8)
  }
}

private struct SectionHeader: View {
  let title: String
  let status: RepoStatus

  var body: some View {
    Text(verbatim: title)
      .font(.caption.weight(.semibold))
      .textCase(nil)
      .foregroundStyle(status.tint)
  }
}

#if DEBUG
  #Preview {
    @Previewable @State var store = AppStore(api: FixtureAPI(scenario: .ranking))
    Group {
      if let ranking = store.ranking.value {
        RankingView(ranking: ranking)
      }
    }
    .frame(width: 640, height: 480)
    .task { await store.refresh() }
  }
#endif
