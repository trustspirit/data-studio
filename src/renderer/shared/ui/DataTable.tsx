import styled from 'styled-components'

/** Shared treatment for schema metadata and audit tables. */
export const DataTable = styled.table`
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.label};
  th, td {
    text-align: left;
    padding: 10px 14px;
    border-bottom: 1px solid ${({ theme }) => theme.color.border.soft};
    vertical-align: middle;
  }
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: ${({ theme }) => theme.color.surface.base};
    color: ${({ theme }) => theme.color.text.dim};
    font-weight: 600;
    white-space: nowrap;
  }
  tbody tr:nth-child(even) { background: ${({ theme }) => theme.color.grid.alternate}; }
  tbody tr:hover { background: ${({ theme }) => theme.color.row.hover}; }
  td:first-child { font-family: ${({ theme }) => theme.font.mono}; }
  td:empty::after { content: '—'; color: ${({ theme }) => theme.color.text.faint}; }
`
