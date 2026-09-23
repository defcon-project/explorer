import { Link } from 'react-router-dom';
import { HiOutlineHome, HiOutlineMagnifyingGlass } from 'react-icons/hi2';
import StatePanel from '../components/ui/StatePanel';

export default function NotFoundPage() {
  return (
    <div className="fade-in">
      <StatePanel
        title="404 — Page not found"
        description="The page you requested does not exist or has moved."
        action={
          <div className="cluster state-panel-actions">
            <Link to="/" className="btn btn-primary">
              <HiOutlineHome /> Go Home
            </Link>
            <Link to="/blocks" className="btn btn-secondary">
              <HiOutlineMagnifyingGlass /> Browse Blocks
            </Link>
          </div>
        }
      />
    </div>
  );
}
