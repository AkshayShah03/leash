import { useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridApi, GridReadyEvent, ICellRendererParams, RowClickedEvent } from 'ag-grid-community';
import { gridTheme, gridThemeDark } from '../grid/theme';
import { useIsDark } from '../lib/theme';
import { formatTime, formatUsd } from '../lib/format';
import { canRefund, decidedBy } from '../lib/ledger';
import type { LedgerEvent, Proposal } from '../lib/types';
import StatusChip from './StatusChip';
import RefundControl from './RefundControl';

interface Ctx {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
  onToast: (msg: string) => void;
}
type Params = ICellRendererParams<Row, unknown, Ctx>;

interface Row {
  proposal: Proposal;
  id: string;
  time: string;
  title: string;
  merchant: string;
  priceCents: number;
  status: Proposal['status'];
  match: number | null;
  decidedBy: string;
  orderId: string;
}

interface Props {
  proposals: Proposal[];
  events: LedgerEvent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
  onToast: (msg: string) => void;
}

export default function LedgerGrid({ proposals, events, selectedId, onSelect, onChanged, onToast }: Props) {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const apiRef = useRef<GridApi<Row> | null>(null);
  const rows = useMemo<Row[]>(
    () =>
      [...proposals]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((p) => ({
          proposal: p,
          id: p.id,
          time: p.createdAt,
          title: p.input.title,
          merchant: p.input.merchant,
          priceCents: p.input.priceCents,
          status: p.status,
          match: p.intent ? Math.round(p.intent.score * 100) : null,
          decidedBy: decidedBy(events, p.id),
          orderId: p.paypal.orderId ?? '',
        })),
    [proposals, events],
  );
  const cols = useMemo<ColDef<Row>[]>(
    () => [
      { field: 'time', headerName: 'Time', flex: 1, minWidth: 130, valueFormatter: (p) => formatTime(p.value as string) },
      {
        field: 'title', headerName: 'Product', flex: 2, minWidth: 180,
        tooltip: (p) => p.data?.title,
        cellRenderer: (p: Params) =>
          p.data ? (
            <button
              type="button"
              className="lcell-link"
              title={p.data.title}
              aria-expanded={p.context.selectedId === p.data.id}
              onClick={(e) => { e.stopPropagation(); onSelectRef.current(p.data!.id === p.context.selectedId ? null : p.data!.id); }}
            >
              {p.data.title}
            </button>
          ) : null,
      },
      { field: 'merchant', headerName: 'Merchant', flex: 1, minWidth: 120 },
      { field: 'priceCents', headerName: 'Price', width: 90, type: 'rightAligned', valueFormatter: (p) => formatUsd(p.value as number) },
      { field: 'status', headerName: 'Status', flex: 1, minWidth: 170, cellRenderer: (p: Params) => (p.data ? <StatusChip status={p.data.status} /> : null) },
      {
        field: 'match', headerName: 'AI match', width: 90,
        valueFormatter: (p) => (p.value == null ? '—' : `${p.value as number}%`),
      },
      { field: 'decidedBy', headerName: 'Decided by', width: 110 },
      {
        field: 'orderId', headerName: 'PayPal order', flex: 1, minWidth: 130, tooltip: (p) => p.data?.orderId,
        cellRenderer: (p: Params) => (p.value ? <span className="lmono" title={String(p.value)}>{String(p.value)}</span> : <span className="lmuted">—</span>),
      },
      {
        headerName: 'Actions', colId: 'actions', width: 150, minWidth: 150, pinned: 'right', sortable: false, resizable: false,
        cellRenderer: (p: Params) =>
          p.data && canRefund(p.data.proposal) && p.context ? (
            <RefundControl proposal={p.data.proposal} onChanged={p.context.onChanged} onToast={p.context.onToast} />
          ) : null,
      },
    ],
    [],
  );
  const dark = useIsDark();
  const context = useMemo<Ctx>(() => ({ selectedId, onSelect, onChanged, onToast }), [selectedId, onSelect, onChanged, onToast]);

  const prevSelected = useRef<string | null>(selectedId);
  useEffect(() => {
    const api = apiRef.current;
    const prev = prevSelected.current;
    prevSelected.current = selectedId;
    if (!api) return;
    // refreshCells re-renders cells (aria-expanded) but does not re-evaluate rowClassRules,
    // so redraw just the two affected rows and put focus back on the product button.
    const nodes = [prev, selectedId].map((id) => (id ? api.getRowNode(id) : undefined)).filter((n) => !!n);
    const focusedId = (document.activeElement as HTMLElement | null)?.closest?.('.lcell-link')?.closest('[row-id]')?.getAttribute('row-id');
    api.refreshCells({ force: true });
    if (!nodes.length) return;
    api.redrawRows({ rowNodes: nodes });
    if (focusedId) {
      requestAnimationFrame(() => {
        // Only restore if the redraw dropped focus; never steal it from the audit heading.
        if (document.activeElement && document.activeElement !== document.body) return;
        document.querySelector<HTMLElement>(`[row-id="${CSS.escape(focusedId)}"] .lcell-link`)?.focus();
      });
    }
  }, [selectedId]);

  return (
    <div className={`lgrid ${dark ? 'lgrid--dark' : 'lgrid--light'}`} role="region" aria-label="Purchase ledger table">
      <AgGridReact<Row>
        theme={dark ? gridThemeDark : gridTheme}
        rowData={rows}
        columnDefs={cols}
        context={context}
        getRowId={(p) => p.data.id}
        defaultColDef={{ sortable: true, resizable: true }}
        rowClass="lrow"
        rowClassRules={{ 'lrow--selected': (p) => p.data?.id === p.context?.selectedId }}
        onGridReady={(e: GridReadyEvent<Row>) => { apiRef.current = e.api; }}
        onRowClicked={(e: RowClickedEvent<Row>) => {
          // AG Grid's native row listener fires before React's stopPropagation can apply, so ignore clicks on
          // interactive controls (Refund/Confirm/Cancel). The Product button calls onSelect itself.
          if ((e.event?.target as HTMLElement | null)?.closest?.('button, a, input, .lrefund')) return;
          if (e.data) onSelect(e.data.id === selectedId ? null : e.data.id);
        }}
        rowHeight={52}
        domLayout="autoHeight"
      />
    </div>
  );
}
