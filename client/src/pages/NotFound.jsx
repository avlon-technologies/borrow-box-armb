import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <EmptyState icon="🧭" title="This page wandered off" action={<Link className="btn btn-primary" to="/">Back to exploring</Link>}>
      The link may be old, or the thing it pointed to is no longer shared.
    </EmptyState>
  );
}
