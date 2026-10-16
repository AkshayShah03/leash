import { useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { formatUsd } from '../lib/format';
import type { Proposal } from '../lib/types';

interface Props {
  proposal: Proposal;
  onChanged: () => void;
  onToast: (msg: string) => void;
}

export function refundErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) return 'Already refunded or not refundable';
  if (e instanceof ApiError) return e.code ? e.code : `Request failed (${e.status}). Try again.`;
  return "Can't reach the gateway. Check your connection.";
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
      onToast(refundErrorMessage(e));
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
