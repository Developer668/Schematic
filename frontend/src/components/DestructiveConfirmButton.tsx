import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * A small, shared guard for destructive workspace controls.
 *
 * The first activation only arms the control. A second activation for the
 * same target performs the operation. Changing the target always disarms it,
 * which prevents a confirmation intended for one component/project from
 * being applied to another one after selection changes.
 */
export interface DestructiveConfirmButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children" | "onClick" | "title" | "type"> {
  targetKey: string;
  onConfirm: () => void;
  children: ReactNode;
  confirmChildren: ReactNode;
  "aria-label": string;
  confirmAriaLabel: string;
  title?: string;
  confirmTitle?: string;
}

export default function DestructiveConfirmButton({
  targetKey,
  onConfirm,
  children,
  confirmChildren,
  "aria-label": ariaLabel,
  confirmAriaLabel,
  title,
  confirmTitle,
  className,
  ...buttonProps
}: DestructiveConfirmButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    setArmed(false);
  }, [targetKey]);

  return (
    <button
      {...buttonProps}
      type="button"
      className={[className, armed ? "is-confirmation-armed" : ""].filter(Boolean).join(" ")}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
      aria-label={armed ? confirmAriaLabel : ariaLabel}
      aria-pressed={armed}
      data-confirmation-armed={armed ? "true" : "false"}
      title={armed ? confirmTitle ?? confirmAriaLabel : title ?? ariaLabel}
    >
      {armed ? confirmChildren : children}
    </button>
  );
}
