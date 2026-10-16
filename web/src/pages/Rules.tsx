export default function Rules({ creating }: { creating?: boolean }) {
  return <h2 className="page-title">Rules{creating ? ' (create)' : ''}</h2>;
}
