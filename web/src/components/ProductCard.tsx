import { formatUsd, safeHref } from '../lib/format';
import type { ProductSummary } from '../lib/types';

export function cheapestOffer(p: ProductSummary) {
  const inStock = p.offers.filter((o) => /in.?stock/i.test(o.availability));
  const pool = inStock.length ? inStock : p.offers;
  return pool.reduce<ProductSummary['offers'][number] | null>((a, o) => (!a || o.priceCents < a.priceCents ? o : a), null);
}

export default function ProductCard({ product }: { product: ProductSummary }) {
  const img = safeHref(product.imageUrl);
  const offer = cheapestOffer(product);
  const href = safeHref(offer?.url);
  return (
    <article className="pcard">
      <div className="pcard__img">
        {img ? <img src={img} alt={product.title} loading="lazy" /> : <span className="pcard__noimg" aria-hidden="true" />}
      </div>
      <h3 className="pcard__title">{product.title}</h3>
      {product.brand && <p className="pcard__brand">{product.brand}</p>}
      <div className="pcard__foot">
        <span className="pcard__price">{offer ? formatUsd(offer.priceCents) : 'No offers'}</span>
        {href && (
          <a className="pcard__link" href={href} target="_blank" rel="noopener noreferrer" aria-label={`View ${product.title}`}>
            View
          </a>
        )}
      </div>
    </article>
  );
}
