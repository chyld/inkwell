### 1. [low] Cancelling Empty Trash still closes the open note

Where: src/web/App.tsx:280

Open a note, switch to Trash, click Empty Trash, then Cancel: the flow returns false but the code after it still runs `setSelected(null)` and reloads, so the editor pane is cleared and the selection lost; the note's pending save is neither waited for nor reported (a failed save now surfaces no notice). Deselect and reload only when the flow returns true.

VERDICT: SHIP — every Round 2 fix in the saver/draft, upload and Trash area is genuinely and completely implemented with tests that fail without it, the rewritten copy test still proves clean-up cannot remove an image the copy needs, and R8's "not a defect" verdict is sound; the one low defect above is a cancel-path UI regression, not a blocker.
END-OF-REVIEW
