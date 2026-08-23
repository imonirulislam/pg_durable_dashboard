import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary text, shown dimmed after the label. */
  hint?: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}

/** Listbox rather than a native select, whose popup the OS draws unstyled. */
export default function Select({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = 'select…',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selectedIndex = useMemo(
    () => Math.max(0, options.findIndex((o) => o.value === value)),
    [options, value]
  );
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (open) setActive(selectedIndex);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Keep the highlighted row in view.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        if (!open) {
          setOpen(true);
          return;
        }
        setActive((current) => {
          const next = current + step;
          if (next < 0) return options.length - 1;
          if (next >= options.length) return 0;
          return next;
        });
        return;
      }
      case 'Home':
        if (open) {
          event.preventDefault();
          setActive(0);
        }
        return;
      case 'End':
        if (open) {
          event.preventDefault();
          setActive(options.length - 1);
        }
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) commit(active);
        else setOpen(true);
        return;
      case 'Escape':
        if (open) {
          event.preventDefault();
          // Don't also close a dialog this sits in.
          event.stopPropagation();
          setOpen(false);
        }
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
  };

  return (
    <div className={`select ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className={`select-trigger${open ? ' open' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">
          {selected ? (
            <>
              {selected.label}
              {selected.hint && <span className="select-hint">{selected.hint}</span>}
            </>
          ) : (
            <span className="select-hint">{placeholder}</span>
          )}
        </span>
        <span className="select-caret" aria-hidden="true" />
      </button>

      {open && (
        <ul
          className="select-list"
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          ref={listRef}
          tabIndex={-1}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              data-index={index}
              data-value={option.value}
              className={`select-option${index === active ? ' active' : ''}${
                option.value === value ? ' selected' : ''
              }`}
              onMouseEnter={() => setActive(index)}
              onClick={() => commit(index)}
            >
              <span className="select-option-label">{option.label}</span>
              {option.hint && <span className="select-hint">{option.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
