import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { api } from '../src/lib/api';

describe('App session gate', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows an unreachable state with Retry on network errors, not Login', async () => {
    const spy = vi.spyOn(api, 'session').mockRejectedValueOnce(new TypeError('fetch failed'));
    render(<App />);
    expect(await screen.findByText("Can't reach the Leash server")).toBeTruthy();
    expect(screen.queryByLabelText('Passcode')).toBeNull();
    spy.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Passcode')).toBeTruthy();
  });
});
