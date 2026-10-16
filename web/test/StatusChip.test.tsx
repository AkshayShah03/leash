import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusChip from '../src/components/StatusChip';
import { statusLabel } from '../src/lib/format';
import type { ProposalStatus } from '../src/lib/types';

const ALL: ProposalStatus[] = [
  'proposed', 'auto_approved', 'pending_human', 'denied', 'human_approved',
  'captured', 'tracked', 'refunded', 'failed',
];

describe('StatusChip', () => {
  it.each(ALL)('renders label text for %s', (s) => {
    render(<StatusChip status={s} />);
    expect(screen.getByText(statusLabel(s))).toBeTruthy();
  });
});
