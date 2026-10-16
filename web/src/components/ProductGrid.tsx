import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import { gridTheme, gridThemeDark } from '../grid/theme';
import { useIsDark } from '../lib/theme';
import { formatUsd, safeHref } from '../lib/format';
import type { ProductSummary } from '../lib/types';

interface Row {
  product: string;
  brand: string;
  merchant: string;
  priceCents: number;
  availability: string;
  category: string;
  url: string | undefined;
}

export default function ProductGrid({ products }: { products: ProductSummary[] }) {
  const rows = useMemo<Row[]>(
    () =>
      products.flatMap((p) =>
        p.offers.map((o) => ({
          product: p.title,
          brand: p.brand ?? '',
          merchant: o.domain,
          priceCents: o.priceCents,
          availability: o.availability,
          category: p.category,
          url: safeHref(o.url),
        })),
      ),
    [products],
  );
  const cols = useMemo<ColDef<Row>[]>(
    () => [
      { field: 'product', headerName: 'Product', flex: 2, minWidth: 200 },
      { field: 'brand', headerName: 'Brand', flex: 1, minWidth: 110 },
      { field: 'merchant', headerName: 'Merchant', flex: 1, minWidth: 140 },
      { field: 'priceCents', headerName: 'Price', width: 110, valueFormatter: (p) => formatUsd(p.value as number) },
      { field: 'availability', headerName: 'Availability', width: 140 },
      { field: 'category', headerName: 'Category', flex: 1, minWidth: 140 },
    ],
    [],
  );
  const dark = useIsDark();
  return (
    <div className="pgrid" role="region" aria-label="Product comparison table">
      <AgGridReact<Row>
        theme={dark ? gridThemeDark : gridTheme}
        rowData={rows}
        columnDefs={cols}
        defaultColDef={{ sortable: true, resizable: true }}
        domLayout="autoHeight"
      />
    </div>
  );
}
