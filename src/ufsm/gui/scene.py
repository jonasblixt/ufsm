from __future__ import annotations

import logging

from PySide6.QtCore import QObject, QRect, QRectF, Qt
from PySide6.QtGui import (
    QBrush,
    QColor,
    QKeyEvent,
    QPainter,
    QPen,
)
from PySide6.QtWidgets import (
    QGraphicsScene,
    QGraphicsSceneMouseEvent,
)

from .const import UFSM_GRID_SNAP

# TODO: Adjust grid depending on zoom level
# TODO: Clamp zoom levels to a min/max

LOGGER = logging.getLogger(__name__)

class UfsmScene(QGraphicsScene):
    grid_pen = QPen(QColor(0x3C, 0x38, 0x36))

    def __init__(self, parent: QObject) -> None:
        super().__init__(parent)
        bg = QColor(0x28, 0x28, 0x28)
        self.bg_brush = QBrush(bg)

    # Here we can capture mouse press/release and key press/release events
    # and feed into a small state machine for drawing control. We can choose
    # to not send the events further down to "Items" by not calling the
    # super class.
    def mousePressEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        super().mousePressEvent(event)

    def keyPressEvent(self, event: QKeyEvent) -> None:
        super().keyPressEvent(event)
        LOGGER.debug("UfsmScene key: %i", event.key())
        if Qt.Key.Key_A == event.key():
            LOGGER.debug("A!")
        if Qt.Key.Key_Escape == event.key():
            LOGGER.debug("Esc")

    def drawBackground(self, painter: QPainter, rect: QRectF | QRect) -> None:
        painter.fillRect(rect, self.bg_brush)
        painter.translate(0.5, 0.5)
        painter.setPen(self.grid_pen)

        x, y, right, bottom = rect.toRect().getCoords() # type: ignore  # noqa: PGH003
        top = y
        left = x
        step = UFSM_GRID_SNAP

        yrest = y % step
        if yrest:
            y += step - yrest
        for vline in range(y, bottom, step):
            painter.drawLine(left, vline, right, vline)

        xrest = x % step
        if xrest:
            x += step - xrest
        for hline in range(x, right, step):
            painter.drawLine(hline, top, hline, bottom)
