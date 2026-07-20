import styled from 'styled-components'

export const Panel = styled.div`
  background: ${({ theme }) => theme.color.panel};
  border: 1px solid ${({ theme }) => theme.color.borderSoft};
  border-radius: 8px;
`
