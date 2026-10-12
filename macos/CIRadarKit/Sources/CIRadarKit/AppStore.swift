import Foundation
import Observation
import os

/// All of the app's state, and the only thing that talks to the API.
@Observable @MainActor
public final class AppStore {
  public private(set) var repos: LoadState<[Repo]> = .idle
  public var selectedRepoID: Repo.ID?

  @ObservationIgnored private let api: any CIRadarAPI
  @ObservationIgnored private let logger = Logger(subsystem: "dev.ciradar.CIRadar", category: "AppStore")

  public init(api: any CIRadarAPI) {
    self.api = api
  }

  /// Fetches the repo list, keeping any list already on screen until the new one arrives,
  /// and selects the first repo if nothing (or a repo that's gone) was selected.
  public func refresh() async {
    if repos.value == nil {
      repos = .loading
    }
    do {
      let list = try await api.repos()
      logger.info("Loaded \(list.count) repos")
      repos = .loaded(list)
      if !list.contains(where: { $0.id == selectedRepoID }) {
        selectedRepoID = list.first?.id
      }
    } catch {
      logger.error("Loading repos failed: \(String(describing: error), privacy: .public)")
      repos = .failed(error)
    }
  }
}
