# Checking the factory floor by hand

The factory floor shows an ankur run inside Claude Code: a band above the prompt, and a pane you open with `/floor`. Tests cover its logic. These steps cover what a test cannot: the real app on your machine. Run them on each system you use (Linux, macOS, Windows) and on each surface (the terminal, the desktop app, and the Claude app over remote control).

The floor only reads. It never writes to a run folder or to your inbox, and it never sends anything to your session. An action in the Your move tab puts a line in your prompt box; only your own Enter sends it. Steps 1 to 8 change nothing. Steps 9 and 15 to 21 fill your prompt box. Steps 16 and 17 end with you pressing Enter, which decides a real inbox item: pick an item you mean to decide.

The command is `/floor`. The engine serves a registered command as `/<name>`, with no plugin prefix, so it is never `/ankur:floor`.

The floor starts only in sessions the engine marks interactive (a person at the prompt). A `claude -p` run or the Agent SDK shows no band and has no `/floor`. Steps 13 (remote control) and 14 (the desktop app) are where this gets checked on those surfaces.

1. Open Claude Code in a repository whose `.git/ankur/` folder holds an ankur run, with the ankur plugin installed. Look above the prompt, before you type anything. In a repository with no run, look for an error.
   You should see: a band above the prompt with the goal, the stage timeline (for example `S0 ✓ S1 ▲`), how many crews are running or stuck, how many need you, and a **Floor** button. In a repository with no run there is no band and no error.

2. Type `/floor` and press Enter.
   You should see: the transcript says `Factory floor opened: run <path>`, naming the newest run of this repository, and the pane opens beside the chat.

3. In the Crews tab, press **f: Show finished stages**, then press a crew. Press the same crew again.
   You should see: every stage listed, finished ones marked ✓. The crew lists its members with their type, model, effort and state. Pressing it again folds it.

4. Open the Decisions tab.
   You should see: the newest decisions first, each as a time, the run and the decision text.

5. Open the ADRs tab.
   You should see: one row per decision record in the folder that `.claude/ankur.json` names, each with its status.

6. Open the Design tab, then press **j: ›** and **k: ‹**.
   You should see: the architecture doc's diagrams drawn as box art, with a counter such as `1/3` that goes up and down. A diagram wider than the pane is cut off at its edge.

7. While a run is live, watch the Crews tab for ten seconds.
   You should see: new crews, states and decisions appear within about five seconds, and nothing flickers when nothing changed.

8. Open the Your move tab on a run that has open questions in the inbox.
   You should see: each open item as its kind in words and its id (for example `Question  <id>` or `Plan approval  <id>`, never `client-question`), its title on the next line, and the band's `need you` count equal to the open items plus the stuck crews.

9. On a run with a stuck crew, press the crew, then press **Restart builder** (`r`, or the first button it shows), then **Confirm** (`o`).
   You should see: before the confirm, a preview that reads `Puts this line in your prompt box. Nothing is sent until you press Enter there.` above a line such as `Crew <name> is stuck: <what stalled>. Restart its builder.` After the confirm, the pane reads `In your prompt box:` and the line, a toast reads `Line put in your prompt box`, and the line sits in your prompt box, not sent. Clear the prompt box, or press Enter to send it.

10. In a linked worktree of the same repository (made with `git worktree add`), repeat steps 1 and 5.
    You should see: the same run and the same decision records as in the main checkout.

11. On Windows, type `/floor` followed by the run folder written with backslashes, for example `C:\path\to\repo\.git\ankur\<session>`.
    You should see: the same result as step 2, and the ADRs and Design tabs fill in, because they are found from the repository three folders up. On macOS, repeat step 2 from a repository under a symlinked folder such as `/var` or a folder with a space in its name, and see the same result.

12. Make the terminal about 120 columns wide.
    You should see: the pane gives way and the band still fits on one line, with the goal shortened.

13. Start Claude Code with remote control on, open that session in the Claude app, and type `/floor` in the app.
    You should see: the band above the prompt and the pane in the Claude app, showing the same run and the same counts as the terminal.

14. In the Claude desktop app, open a session in this repository with the ankur plugin installed.
    You should see: the band above the prompt, and `/floor` opens the pane.

## Actions in Your move

Tests already cover the action flow's logic, so you do not check these by hand:

- Each action shows the exact line before anything is sent, and a stray key alone fills nothing.
- Approve and Reject fill the whole `/ankur:inbox approve|reject <id> <code>` line, an answer fills `/ankur:inbox answer <id> <code> ` for your words, and a stuck-crew action fills its stuck-crew message.
- The floor never submits, and picking, previewing and confirming every action leaves the run folder byte for byte the same.
- A draft in the prompt box is never replaced, an item resolved meanwhile fills nothing, a changed code redraws the line and needs a second confirm, and a check that hangs for 5 seconds offers **Try again**.
- The toast after a fill carries neither the line nor the code.
- The approve, reject and answer lines, typed by you, resolve the item, and the same line sent by a plugin is refused.

These steps cover what a test cannot: the real prompt box on each system and surface. Use the terminal for steps 15 to 18.

15. Open the Your move tab on a run with an open plan approval. Press its row, then press **Approve** (`p`).
    You should see: `If you approve:` and `If you reject:` lines above the **Approve** and **Reject** buttons, then a preview with the lead `Puts this line in your prompt box. Nothing is sent until you press Enter there.`, the whole line `/ankur:inbox approve <id> <code>`, and **Confirm** (`o`) and **Cancel** (`x`). If the preview shows the line without the code and the words `Then type the code: <code>`, this build fills without the code, and you type it after the line.

16. Press **Confirm**. Then go to your prompt and press Enter.
    You should see: after the confirm, the pane reads `In your prompt box:` with the line and `Your prompt box has the keys now: press Enter there to send it.`, a toast reads `Line put in your prompt box` with no code in it, and the line waits in your prompt box. Nothing reaches the transcript until your Enter. After the Enter, the item resolves, and within about five seconds it leaves Your move.

17. On a run with an open question, press its row, then **Answer in my own words** (`w`), then **Confirm**. In the prompt box, type your answer after the line and press Enter.
    You should see: before the confirm, `Then type your answer after the code.` under the line; after it, `Type your answer at the end of the line, then press Enter.` and a **Done** button with no key of its own, so typing does not touch it. The line `/ankur:inbox answer <id> <code> ` ends in a space, put in your prompt box. After the Enter, the question resolves with your words.

18. Type some text in your prompt box and do not send it. In Your move, press **Approve** on a plan approval, then **Confirm**.
    You should see: `Your prompt box has text in it. The floor will not replace it. Clear it, or copy the line below.`, the line still on screen, and **Check again** and **Cancel**. Your text in the prompt box is unchanged. Clear it and press **Check again**: the preview offers **Confirm** again, and nothing is filled until you press it.

19. On Windows and on macOS, repeat steps 15 and 16 in the terminal at about 120 columns with the pane open.
    You should see: the same results as on Linux, with the preview line wrapped onto further rows and nothing cut off.

20. In the Claude desktop app, repeat steps 15 and 16.
    You should see: the line in the desktop app's prompt box, not sent, and the item resolved only after you press Enter there.

21. Start Claude Code with remote control on, open that session in the Claude app, and repeat steps 15 and 16 from the app.
    You should see: TODO, live: nobody has yet checked how the fill behaves over remote control. Write down whether the line lands in the app's prompt box, the terminal's, both or neither, and confirm that nothing is sent before an Enter.

The hotkeys (`c y d a g f j k`) work once the pane has focus: click it first.
