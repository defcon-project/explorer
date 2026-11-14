import { Component, type ReactNode } from 'react';
import StatePanel from '../ui/StatePanel';
import { ReloadPageButton } from '../layout/RouteErrorBoundary';
import { reloadAfterChunkFailure } from '../../utils/releaseReload';

interface ChartBoundaryState {
  failed: boolean;
  reloading: boolean;
}

/**
 * A lazily loaded chart that fails (most likely its chunk, after a deploy) leaves the rest of the
 * page working. Like a failed page, a missing chunk first reloads the tab once.
 */
export default class ChartBoundary extends Component<{ children: ReactNode }, ChartBoundaryState> {
  state: ChartBoundaryState = { failed: false, reloading: false };

  static getDerivedStateFromError(): Partial<ChartBoundaryState> {
    return { failed: true };
  }

  componentDidCatch() {
    if (reloadAfterChunkFailure()) this.setState({ reloading: true });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.state.reloading) {
      return <div role="status"><StatePanel title="Loading the latest version..." /></div>;
    }
    return (
      <div role="alert">
        <StatePanel
          tone="warning"
          title="The chart could not be loaded"
          description="The hourly numbers are still listed below."
          action={<ReloadPageButton />}
        />
      </div>
    );
  }
}
