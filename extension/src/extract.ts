import { Readability } from '@mozilla/readability'

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'unknown'
  }
}

const clone = document.documentElement.cloneNode(true)
const doc = new Document()
doc.appendChild(clone)
const article = new Readability(doc).parse()
const selection = window.getSelection()?.toString().trim() ?? ''
const text = (article?.textContent ?? document.body.innerText).trim()
const title = article?.title ?? document.title
const payload = { origin: originOf(location.href), title, text, selection }
document.documentElement.setAttribute('data-tobari-extract', JSON.stringify(payload))
