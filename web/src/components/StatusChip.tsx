import { statusLabel, statusTone } from '../lib/format';
import type { ProposalStatus } from '../lib/types';

export default function StatusChip({ status }: { status: ProposalStatus }) {
  return (
    <span className={`chip chip--${statusTone(status)}`}>
      <span className="chip__dot" aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}
