import { useIconGrid } from '../../shared/useIconGrid';
import { WIDGET_GROUPS } from './widget-links';
export function useWidgetLinks() {
  return useIconGrid({
    groups: WIDGET_GROUPS,
    storageKey: 'categories',
    root: '.bottom-widgets',
    columns: 4,
    rows: 2,
  });
}
