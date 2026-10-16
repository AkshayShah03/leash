import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from '../src/pages/Login';
import { api, ApiError } from '../src/lib/api';

describe('Login', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows an error on 401 and does not call onSuccess', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiError(401, 'unauthorized'));
    const onSuccess = vi.fn();
    render(<Login onSuccess={onSuccess} />);
    await userEvent.type(screen.getByLabelText('Passcode'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Wrong passcode')).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('calls onSuccess on success', async () => {
    const spy = vi.spyOn(api, 'login').mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    render(<Login onSuccess={onSuccess} />);
    await userEvent.type(screen.getByLabelText('Passcode'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith('secret');
  });
});
