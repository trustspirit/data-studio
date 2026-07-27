import styled from 'styled-components'

export const Panel = styled.div`
  background: ${({ theme }) => theme.color.surface.panel};
  border: 1px solid ${({ theme }) => theme.color.border.soft};
  border-radius: 8px;
`
