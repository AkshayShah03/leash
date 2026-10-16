import { useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import { humanizeError } from '../lib/errors';
import { formatUsd } from '../lib/format';
import type { Proposal } from '../lib/types';

interface Props {
  proposal: Proposal;
  onChanged: () => void;
  onToast: (msg: string) => void;
}

export default function RefundControl({ proposal, onChanged, onToast }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const price = formatUsd(proposal.input.priceCents);

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await api.refund(proposal.id);
      onToast(`Refunded ${price}`);
    } catch (e) {
      onToast(humanizeError(e, { conflict: 'Already refunded or not refundable' }));
    } finally {
      inFlight.current = false;
      setBusy(false);
      setConfirming(false);
      onChanged();
    }
  }

  if (!confirming) {
    return (
      <button type="button" className="btn btn--outline lrefund__btn" aria-label={`Refund ${proposal.input.title}`}
        onClick={() => setConfirming(true)}>
        <Undo2 size={14} aria-hidden="true" />Refund
      </button>
    );
  }
  return (
    <span className="lrefund" role="group" aria-label={`Confirm refund of ${proposal.input.title}`}>
      <span className="lrefund__q">Refund {price}?</span>
      <button type="button" className="btn btn--primary lrefund__btn" disabled={busy} onClick={() => void confirm()}>Confirm</button>
      <button type="button" className="btn btn--ghost lrefund__btn" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
    </span>
  );
}
