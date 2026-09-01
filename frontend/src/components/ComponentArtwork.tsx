import type { CatalogComponent } from "../data/catalog.ts";
import { componentArtworkPath, presentationSvg } from "../data/componentArtwork.ts";

export default function ComponentArtwork({ definition, className = "", alt }: { definition?: CatalogComponent | null; className?: string; alt?: string }) {
  if (!definition) return <div className={className} aria-hidden />;
  const category = definition.category.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const classes = `component-artwork component-artwork-${category} ${className}`;
  const src = componentArtworkPath(definition.id);
  if (src) return <img src={src} alt={alt ?? definition.title} className={classes} draggable={false} loading="lazy" decoding="async" />;
  const thumbnail = definition.thumbnail ? presentationSvg(definition.thumbnail) : "";
  if (thumbnail && /<(?:path|circle|ellipse|line|polyline|polygon|rect|g|image|use)\b/i.test(thumbnail)) {
    return <div role="img" aria-label={alt ?? definition.title} className={`${classes} component-artwork-inline`} dangerouslySetInnerHTML={{ __html: thumbnail }} />;
  }
  return <div className={`${classes} component-artwork-fallback`} aria-label={alt ?? definition.title}>{definition.id.slice(0, 4).toUpperCase()}</div>;
}
