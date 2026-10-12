/// Where one piece of remote data is in its lifecycle.
public enum LoadState<T> {
  case idle
  case loading
  case loaded(T)
  case failed(APIError)

  public var value: T? {
    if case .loaded(let value) = self { return value }
    return nil
  }
}
