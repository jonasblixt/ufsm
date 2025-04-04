
from __future__ import annotations
import sys

from PySide6.QtWidgets import QApplication
from PySide6.QtCore import QPoint, QSizeF, Qt, QPointF
from PySide6.QtGui import (
    QBrush,
    QColor,
    QFont,
    QKeyEvent,
    QPainter,
    QPainterPath,
    QPen,
    QWheelEvent,
)
from PySide6.QtWidgets import (
    QFrame,
    QGraphicsEllipseItem,
    QGraphicsItem,
    QGraphicsObject,
    QGraphicsRectItem,
    QGraphicsScene,
    QGraphicsSceneMouseEvent,
    QGraphicsSimpleTextItem,
    QGraphicsView,
    QStyleOptionGraphicsItem,
    QWidget,
    QMainWindow,
    QVBoxLayout
)

class ResizableRect(QGraphicsRectItem):
    selected_edge = None
    def __init__(self, x, y, width, height, onCenter=False):
        if onCenter:
            super().__init__(-width / 2, -height / 2, width, height)
        else:
            super().__init__(-10, -10, width, height)
        self.setPos(x, y)
        self.setFlags(QGraphicsItem.ItemIsMovable)
        self.setAcceptHoverEvents(True)
        self.setPen(QPen(QBrush(Qt.blue), 5))

        # a child item that shows the current position; note that this is only
        # provided for explanation purposes, a *proper* implementation should
        # use the ItemSendsGeometryChanges flag for *this* item and then
        # update the value within an itemChange() override that checks for
        # ItemPositionHasChanged changes.
        self.posItem = QGraphicsSimpleTextItem(
            '{}, {}'.format(self.x(), self.y()), parent=self)
        self.posItem.setPos(
            self.boundingRect().x(),
            self.boundingRect().y() - self.posItem.boundingRect().height()
        )

    def getEdges(self, pos):
        # return a proper Qt.Edges flag that reflects the possible edge(s) at
        # the given position; note that this only works properly as long as the
        # shape() override is consistent and for *pure* rectangle items; if you
        # are using other shapes (like QGraphicsEllipseItem) or items that have
        # a different boundingRect or different implementation of shape(), the
        # result might be unexpected.
        # Finally, a simple edges = 0 could suffice, but considering the new
        # support for Enums in PyQt6, it's usually better to use the empty flag
        # as default value.

        edges = Qt.Edges()
        rect = self.rect()
        border = self.pen().width() / 2

        if pos.x() < rect.x() + border:
            edges |= Qt.LeftEdge
        elif pos.x() > rect.right() - border:
            edges |= Qt.RightEdge
        if pos.y() < rect.y() + border:
            edges |= Qt.TopEdge
        elif pos.y() > rect.bottom() - border:
            edges |= Qt.BottomEdge

        return edges

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.selected_edge = self.getEdges(event.pos())
            self.offset = QPointF()
        else:
            self.selected_edge = Qt.Edges()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self.selected_edge:
            if abs(event.pos().x()) > 100:
                print(f"pos: {event.pos()}")
            mouse_delta = event.pos() - event.buttonDownPos(Qt.LeftButton)
            rect = self.rect()
            pos_delta = QPointF()
            border = self.pen().width()

            if self.selected_edge & Qt.LeftEdge:
                # ensure that the width is *always* positive, otherwise limit
                # both the delta position and width, based on the border size
                diff = min(mouse_delta.x() - self.offset.x(), rect.width() - border)
                if rect.x() < 0:
                    offset = diff / 2
                    self.offset.setX(self.offset.x() + offset)
                    pos_delta.setX(offset)
                    rect.adjust(offset, 0, -offset, 0)
                else:
                    pos_delta.setX(diff)
                    rect.setWidth(rect.width() - diff)
            elif self.selected_edge & Qt.RightEdge:
                if rect.x() < 0:
                    diff = max(mouse_delta.x() - self.offset.x(), border - rect.width())
                    offset = diff / 2
                    self.offset.setX(self.offset.x() + offset)
                    pos_delta.setX(offset)
                    rect.adjust(-offset, 0, offset, 0)
                else:
                    rect.setWidth(max(border, event.pos().x() - rect.x()))

            if self.selected_edge & Qt.TopEdge:
                # similarly to what done for LeftEdge, but for the height
                diff = min(mouse_delta.y() - self.offset.y(), rect.height() - border)
                if rect.y() < 0:
                    offset = diff / 2
                    self.offset.setY(self.offset.y() + offset)
                    pos_delta.setY(offset)
                    rect.adjust(0, offset, 0, -offset)
                else:
                    pos_delta.setY(diff)
                    rect.setHeight(rect.height() - diff)
            elif self.selected_edge & Qt.BottomEdge:
                if rect.y() < 0:
                    diff = max(mouse_delta.y() - self.offset.y(), border - rect.height())
                    offset = diff / 2
                    self.offset.setY(self.offset.y() + offset)
                    pos_delta.setY(offset)
                    rect.adjust(0, -offset, 0, offset)
                else:
                    rect.setHeight(max(border, event.pos().y() - rect.y()))

            if rect != self.rect():
                self.setRect(rect)
                if pos_delta:
                    self.setPos(self.pos() + pos_delta)
        else:
            # use the default implementation for ItemIsMovable
            super().mouseMoveEvent(event)

        self.posItem.setText('{},{} ({})'.format( self.x(), self.y(), self.rect().getRect()))
        self.posItem.setPos(
            self.boundingRect().x(),
            self.boundingRect().y() - self.posItem.boundingRect().height()
        )

    def mouseReleaseEvent(self, event):
        self.selected_edge = Qt.Edges()
        super().mouseReleaseEvent(event)

    def hoverMoveEvent(self, event):
        edges = self.getEdges(event.pos())
        if not edges:
            self.unsetCursor()
        elif edges in (Qt.TopEdge | Qt.LeftEdge, Qt.BottomEdge | Qt.RightEdge):
            self.setCursor(Qt.SizeFDiagCursor)
        elif edges in (Qt.BottomEdge | Qt.LeftEdge, Qt.TopEdge | Qt.RightEdge):
            self.setCursor(Qt.SizeBDiagCursor)
        elif edges in (Qt.LeftEdge, Qt.RightEdge):
            self.setCursor(Qt.SizeHorCursor)
        else:
            self.setCursor(Qt.SizeVerCursor)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()

        scene = QGraphicsScene(self)
        self.view = QGraphicsView(scene)

        self.rect = ResizableRect(50, 50, 50, 50, False)
        scene.addItem(self.rect)
        self.view.scale(2,2)

        central = QWidget()

        layout = QVBoxLayout(central)
        layout.addWidget(self.view)

        self.setCentralWidget(central)

def main() -> None:
    # Initialize the QApplication
    app = QApplication(sys.argv)
    # Set up the main window
    main_window = MainWindow()
    main_window.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()