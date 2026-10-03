"""Single-process reminder scheduler foundation.

Run this in exactly one dedicated worker for a deployment. It reconciles persisted
reminders on boot; delivery attempts should be recorded in NotificationLog before
adding email or push providers, making each execution idempotent.
"""
from apscheduler.schedulers.background import BackgroundScheduler


class ReminderScheduler:
    def __init__(self) -> None:
        self.scheduler = BackgroundScheduler(timezone="UTC")

    def start(self) -> None:
        if not self.scheduler.running:
            self.scheduler.start()

    def shutdown(self) -> None:
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
