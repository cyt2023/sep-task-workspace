# SEP task workspace — browser demo

Live demo: https://cyt2023.github.io/sep-task-workspace/

A static demonstration of the task input interface for hospital robot tasks.
Create tasks, set schedules and repetitions, import JSON arrays, query due tasks, inspect
records and cancel tasks.

Tasks are saved in each visitor's browser localStorage. Each browser has its own
workspace. This demo has no shared Python backend and does not control a robot.
Clearing browser site data removes that browser's demo tasks.

The published task schema supplies validation rules. The Python TaskManager
remains the authority for the separately run, backend-connected application.

This repository contains only the static demo assets. GitHub Pages publishes the
`main` branch root; `.nojekyll` disables Jekyll processing.

Licensed under Apache-2.0; see LICENSE.
