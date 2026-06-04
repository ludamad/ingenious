// Emscripten/Embind bindings: expose the Ingenious engine to JS (browser + Node).
// All structured data crosses the boundary as plain JS objects via emscripten::val.
#include "ingenious.hpp"
#include <emscripten/bind.h>
#include <emscripten/val.h>

using namespace emscripten;
using ing::Game;
using ing::Move;

namespace {

val moveToVal(const Move& m) {
    val o = val::object();
    o.set("tileIndex", m.tileIndex);
    o.set("q", m.q); o.set("r", m.r);
    o.set("dir", m.dir); o.set("flip", m.flip);
    return o;
}

// Thin wrapper so JS sees a clean class with val-returning methods.
class IngGame {
public:
    IngGame(int numPlayers, double seed, int boardRadius)
        : g_(numPlayers, (uint64_t)(seed < 0 ? 0 : seed), boardRadius) {}

    val state() const {
        val s = val::object();
        s.set("numPlayers", g_.numPlayers());
        s.set("regionRadius", g_.regionRadius());
        s.set("cap", g_.cap());
        s.set("solitaire", g_.solitaire());
        s.set("current", g_.current());
        s.set("pendingBonus", g_.pendingBonus());
        s.set("finished", g_.finished());
        s.set("firstRound", g_.firstRound());
        s.set("bagCount", g_.bagCount());

        val cells = val::array();
        int i = 0;
        for (auto& c : g_.cells()) {
            val cv = val::object();
            cv.set("q", c[0]); cv.set("r", c[1]);
            cv.set("color", (int)g_.cellAt(c[0], c[1]));   // -1 empty, 0..5 color
            cells.set(i++, cv);
        }
        s.set("cells", cells);

        val scores = val::array();
        for (int p = 0; p < g_.numPlayers(); ++p) {
            val row = val::array();
            for (int c = 0; c < 6; ++c) row.set(c, g_.score(p, c));
            scores.set(p, row);
        }
        s.set("scores", scores);

        val hands = val::array();
        for (int p = 0; p < g_.numPlayers(); ++p) {
            val h = val::array();
            int j = 0;
            for (auto& t : g_.hand(p)) {
                val tv = val::object();
                tv.set("a", t[0]); tv.set("b", t[1]);
                h.set(j++, tv);
            }
            hands.set(p, h);
        }
        s.set("hands", hands);
        return s;
    }

    val legalMoves() const {
        val arr = val::array();
        int i = 0;
        for (auto& m : g_.legalMoves()) arr.set(i++, moveToVal(m));
        return arr;
    }

    val applyMove(int tileIndex, int q, int r, int dir, int flip) {
        auto res = g_.applyMove(Move{tileIndex, q, r, dir, flip});
        val o = val::object();
        o.set("ok", res.ok);
        val deltas = val::array();
        int i = 0;
        for (auto& d : res.deltas) {
            val dv = val::object();
            dv.set("color", d.color); dv.set("points", d.points);
            deltas.set(i++, dv);
        }
        o.set("deltas", deltas);
        o.set("ingenious", res.ingenious);
        o.set("bonusPending", res.bonusPending);
        o.set("turnEnded", res.turnEnded);
        o.set("gameOver", res.gameOver);
        return o;
    }

    val aiMove(int level) const {
        Move m = g_.aiMove(level);
        return moveToVal(m);
    }

    // Per-cell best-points preview for a rack tile (both faces, all dirs).
    val tileHeatmap(int tileIndex) const {
        val arr = val::array();
        int i = 0;
        for (auto& h : g_.tileHeatmap(tileIndex)) {
            val o = val::object();
            o.set("q", h.q); o.set("r", h.r); o.set("points", h.points);
            arr.set(i++, o);
        }
        return arr;
    }

    bool canSwap() const { return g_.canSwap(); }
    bool swap() { return g_.swap(); }
    bool pass() { return g_.pass(); }
    bool hasAnyMove() const { return g_.hasAnyMove(); }
    bool finished() const { return g_.finished(); }
    int current() const { return g_.current(); }
    int playerScore(int p) const { return g_.playerScore(p); }

    val ranking() const {
        val arr = val::array();
        int i = 0;
        for (int p : g_.ranking()) arr.set(i++, p);
        return arr;
    }

private:
    Game g_;
};

} // namespace

EMSCRIPTEN_BINDINGS(ingenious) {
    class_<IngGame>("Game")
        .constructor<int, double, int>()
        .function("state",       &IngGame::state)
        .function("legalMoves",  &IngGame::legalMoves)
        .function("applyMove",   &IngGame::applyMove)
        .function("aiMove",      &IngGame::aiMove)
        .function("tileHeatmap", &IngGame::tileHeatmap)
        .function("canSwap",     &IngGame::canSwap)
        .function("swap",        &IngGame::swap)
        .function("pass",        &IngGame::pass)
        .function("hasAnyMove",  &IngGame::hasAnyMove)
        .function("finished",    &IngGame::finished)
        .function("current",     &IngGame::current)
        .function("playerScore", &IngGame::playerScore)
        .function("ranking",     &IngGame::ranking);
}
