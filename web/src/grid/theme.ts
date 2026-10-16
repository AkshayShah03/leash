import {
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  ModuleRegistry,
  RenderApiModule,
  RowStyleModule,
  TooltipModule,
  ValidationModule,
  themeQuartz,
} from 'ag-grid-community';

// Only what the two grids use: client-side rows + sorting (via ClientSideRowModel), row class rules,
// tooltips, getRowNode, and refreshCells/redrawRows. ValidationModule is dev-only (helpful warnings).
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  ClientSideRowModelApiModule,
  RenderApiModule,
  RowStyleModule,
  TooltipModule,
  ...(import.meta.env.DEV ? [ValidationModule] : []),
]);

const base = {
  accentColor: '#5B2EE5',
  borderRadius: 12,
  wrapperBorderRadius: 16,
  fontFamily: 'Inter, system-ui, sans-serif',
  headerFontWeight: 600,
  spacing: 8,
};

export const gridTheme = themeQuartz.withParams({
  ...base,
  backgroundColor: '#FFFFFF',
  foregroundColor: '#14121A',
  headerBackgroundColor: '#EEE9FF',
  headerTextColor: '#3B1C8C',
  borderColor: '#E4E0F0',
});

export const gridThemeDark = themeQuartz.withParams({
  ...base,
  backgroundColor: '#1A1430',
  foregroundColor: '#F3F1FA',
  headerBackgroundColor: '#2A1F5C',
  headerTextColor: '#F3F1FA',
  borderColor: '#4A4463',
});
