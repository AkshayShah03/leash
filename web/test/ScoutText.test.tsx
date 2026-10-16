import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ScoutText from '../src/components/ScoutText';

describe('ScoutText', () => {
  it('renders bold, bullets and paragraphs', () => {
    const { container } = render(<ScoutText text={'Found **two** picks:\n- Alpha **$20**\n- Beta\n\nEnjoy 🎉'} />);
    expect(container.querySelectorAll('strong')).toHaveLength(2);
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect(screen.getByText('Enjoy 🎉')).toBeInTheDocument();
  });

  it('renders HTML-looking text literally', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const { container } = render(<ScoutText text={payload} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe(payload);
  });

  it('leaves unmatched ** as text', () => {
    const { container } = render(<ScoutText text="a **b" />);
    expect(container.querySelector('strong')).toBeNull();
  });
});
