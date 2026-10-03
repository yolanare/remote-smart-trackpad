# Mirror rules stay in the PowerShell bridge, tested from Node

The rules that decide what a PC field holds (readable, placeholder only or unreadable, the corrections to its text)
and when an edit has settled are pure PowerShell functions next to the UI Automation code that feeds them. Node
tests drive them through a small JSON script, so `npm test` covers them without a desktop.

## Considered Options

- Porting the rules to the Node host, the bridge only reporting facts: checking one edit reads the field up to 60
  times, and each read would become a round trip between the processes.
- Pester: Windows ships Pester 3.4 (2016), whose syntax is long outdated; Pester 5 needs an installation on every PC
  that runs the tests.
