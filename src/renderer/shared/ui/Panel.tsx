import styled from 'styled-components'

export const Panel = styled.div`
  background: ${({ theme }) => theme.color.surface.panel};
  border: 1px solid ${({ theme }) => theme.color.borders.soft};
  border-radius: 8px;
`
