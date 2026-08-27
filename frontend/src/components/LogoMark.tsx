export default function LogoMark({ className = "" }: { className?: string }) {
  return <img src="/schematic-logo.png" alt="" aria-hidden="true" className={`logo-mark ${className}`} draggable={false} />;
}
