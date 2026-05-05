/**
 * ScrollableModal accessibility + interaction tests.
 */
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, userEvent } from '../test-utils/index.js';
import { ScrollableModal } from '../../components/scrollable-modal.js';

function Harness({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open modal
      </button>
      <ScrollableModal
        open={open}
        onClose={() => setOpen(false)}
        title="Test Modal"
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button">Save</button>
          </>
        }
      >
        <p>Body content</p>
        <input type="text" placeholder="First field" />
      </ScrollableModal>
    </div>
  );
}

describe('ScrollableModal', () => {
  it('does not render when closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders with role=dialog, aria-modal, and a generated aria-labelledby', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText('Open modal'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const label = document.getElementById(labelledBy!);
    expect(label?.textContent).toBe('Test Modal');
  });

  it('moves focus into the dialog on open', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText('Open modal'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText('Open modal'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on backdrop click but not on dialog click', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText('Open modal'));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(dialog.querySelector('input')!);
    expect(screen.queryByRole('dialog')).toBeInTheDocument();
    // The backdrop is the role=dialog outer node; clicking it directly closes.
    await userEvent.click(dialog);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('restores focus to the trigger after close', async () => {
    render(<Harness />);
    const trigger = screen.getByText('Open modal');
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
  });
});
