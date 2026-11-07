import type { WireValue } from '../../../../shared/types/wire'
import { Button, DataTable, Dialog, ErrorBanner } from '../../../shared/ui'

const text = (value: WireValue | undefined) => value === undefined ? 'DEFAULT' : value.t === 'null' ? 'NULL' : String(value.v)

export function ChangeReview({ edits, deleted, newRows, rows, columns, saving, error, onSave, onClose }: {
  edits: ReadonlyMap<number, ReadonlyMap<string, WireValue>>; deleted: ReadonlySet<number>
  newRows: readonly ReadonlyMap<string, WireValue>[]; rows: readonly (readonly WireValue[])[]
  columns: readonly string[]; saving: boolean; error: string | null; onSave: () => void; onClose: () => void
}) {
  return <Dialog title="변경 내용 검토" onClose={onClose} footer={<>
    <Button variant="ghost" disabled={saving} onClick={onClose}>계속 편집</Button>
    <Button disabled={saving} onClick={onSave}>{saving ? '적용 중…' : 'DB에 변경 적용'}</Button>
  </>}>
    <p>아래 변경을 하나의 트랜잭션으로 적용합니다. 삭제된 행은 저장 후 되돌릴 수 없습니다.</p>
    {error !== null && <ErrorBanner>{error}</ErrorBanner>}
    <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
      <DataTable><thead><tr><th>작업</th><th>행 / 컬럼</th><th>변경 전</th><th>변경 후</th></tr></thead><tbody>
        {[...deleted].map((index) => <tr key={`delete-${index}`}><td>삭제</td><td>행 {index + 1}</td><td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: 400 }}>{JSON.stringify(rows[index]?.map(text))}</td><td>삭제됨</td></tr>)}
        {[...edits].filter(([index]) => !deleted.has(index)).flatMap(([index, cells]) => [...cells].map(([column, value]) => <tr key={`${index}:${column}`}><td>수정</td><td>행 {index + 1} · {column}</td><td>{text(rows[index]?.[columns.indexOf(column)])}</td><td>{text(value)}</td></tr>))}
        {newRows.map((row, index) => <tr key={`insert-${index}`}><td>추가</td><td>새 행 {index + 1}</td><td>—</td><td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: 400 }}>{[...row].map(([column, value]) => `${column}: ${text(value)}`).join('\n') || '입력 값 없음'}</td></tr>)}
      </tbody></DataTable>
    </div>
  </Dialog>
}
