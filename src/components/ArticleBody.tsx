/** Plain text only. React escapes it; never render article bodies as HTML. */
export function ArticleBody({ body }: { body: string }) {
  return <div className="whitespace-pre-wrap break-words text-sm leading-6">{body}</div>;
}
