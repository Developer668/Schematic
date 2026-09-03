"use client";

import {
  forwardRef,
  useState,
  type FocusEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Search, X } from "lucide-react";

export interface GooeyInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "defaultValue"> {
  value: string;
  onValueChange: (value: string) => void;
  onClear?: () => void;
  startIcon?: ReactNode;
  shortcut?: string;
  tone?: "panel" | "page";
  rootClassName?: string;
}

/**
 * Controlled precision search input. The connected surface, icon motion and
 * clear action stay lightweight so filtering remains responsive in dense panels.
 */
export const GooeyInput = forwardRef<HTMLInputElement, GooeyInputProps>(
  function GooeyInput(
    {
      value,
      onValueChange,
      onClear,
      startIcon,
      shortcut,
      tone = "panel",
      rootClassName = "",
      className = "",
      disabled,
      onFocus,
      onBlur,
      type = "search",
      ...inputProps
    },
    forwardedRef,
  ) {
    const [focused, setFocused] = useState(false);
    const filled = value.length > 0;

    const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
      setFocused(true);
      onFocus?.(event);
    };

    const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
      setFocused(false);
      onBlur?.(event);
    };

    const clear = () => {
      if (disabled) return;
      onValueChange("");
      onClear?.();
    };

    return (
      <div
        className={`gooey-input-root is-${tone} ${focused ? "is-focused" : ""} ${filled ? "is-filled" : ""} ${disabled ? "is-disabled" : ""} ${rootClassName}`.trim()}
      >
        <div className="gooey-input-filter-layer" aria-hidden="true">
          <span className="gooey-input-surface" />
          <span className="gooey-input-leading-surface" />
          {filled && <span className="gooey-input-trailing-surface" />}
        </div>

        <span className="gooey-input-icon" aria-hidden="true">
          {startIcon ?? <Search size={14} strokeWidth={1.8} />}
        </span>

        <input
          {...inputProps}
          ref={forwardedRef}
          type={type}
          value={value}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={`gooey-input-control ${className}`.trim()}
        />

        <div className="gooey-input-end">
          {filled ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clear}
              aria-label="Clear search"
              title="Clear search"
              disabled={disabled}
            >
              <X size={12} strokeWidth={1.9} />
            </button>
          ) : shortcut ? (
            <kbd>{shortcut}</kbd>
          ) : null}
        </div>
      </div>
    );
  },
);

GooeyInput.displayName = "GooeyInput";

export default GooeyInput;
