export const DESKTOP_GRID_COLUMNS = 16;
export const HOME_GRID_ROWS = 5;
export const LIBRARY_GRID_ROWS = 8;
export const DESKTOP_GRID_CELL_WIDTH = 84;
export const DESKTOP_GRID_CELL_HEIGHT = 94;
export const DESKTOP_ICON_SIZE = 56;

export const itemMaxColumns = (kind: string) =>
  kind === 'folder' ? DESKTOP_GRID_COLUMNS : kind === 'link' ? 4 : 9;

export const FOLDER_ICON_SIZE = 48;

export const itemMaxRows = (kind: string) => (kind === 'link' ? 4 : 9);

export const FOLDER_DIALOG_COLUMNS = 10;
export const FOLDER_DIALOG_ROWS = 5;
