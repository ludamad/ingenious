// Ingenious — game engine (pure C++17, no platform deps).
// Single source of truth for rules, move generation, scoring and AI.
// Compiled to WASM (via bindings.cpp) for both the browser and the Node server,
// and compiled natively for unit tests (test.cpp).
#pragma once
#include <array>
#include <vector>
#include <cstdint>
#include <algorithm>
#include <string>

namespace ing {

// ---- Hex geometry (axial coordinates q,r ; cube s = -q-r) -------------------
// The six neighbour directions. Direction index 0..5 is used to name tile
// orientation (which neighbour holds a domino's second half).
static constexpr int DIRS[6][2] = {{+1,0},{+1,-1},{0,-1},{-1,0},{-1,+1},{0,+1}};

constexpr int OFF = 8;          // coordinate offset so q,r in [-8,8] map to >=0
constexpr int W   = 17;         // grid width after offset
constexpr int NCELL = W * W;    // flat board array size

inline int encode(int q, int r) { return (q + OFF) * W + (r + OFF); }
inline int hexDist(int q, int r) { return (std::abs(q) + std::abs(r) + std::abs(q + r)) / 2; }

// Cell color codes stored in the flat board array.
constexpr int8_t NONEXIST = -2;  // not part of the board at all
constexpr int8_t EMPTY    = -1;  // playable but empty
constexpr int8_t INACTIVE = -3;  // on the board but reserved (outer ring, fewer players)

// ---- Public data structures --------------------------------------------------
struct Move {
    int tileIndex;   // index into the current player's rack
    int q, r;        // anchor cell (holds the tile's first color)
    int dir;         // direction 0..5 to the partner cell (second color)
    int flip;        // 0: colors=[a,b] at [anchor,partner]; 1: swapped
};

struct ScoreDelta { int color; int points; };

struct MoveResult {
    bool ok = false;
    std::vector<ScoreDelta> deltas;  // points gained per color this move
    int ingenious = 0;               // # of counters that reached the cap ("Ingenious!")
    bool bonusPending = false;       // player gets another (bonus) placement
    bool turnEnded = false;          // turn handed to next player
    bool gameOver = false;
};

struct PrintedCorner { int q, r; int color; };

// The six printed starting symbols sit at the six corners of the board hexagon,
// so they spread further apart as the board radius grows. CORNER_DIR scaled by
// the radius gives each corner cell; CORNER_COLORS assigns one color to each.
static constexpr int CORNER_DIR[6][2] = {{0,-1},{1,-1},{1,0},{0,1},{-1,1},{-1,0}};
static constexpr int CORNER_COLORS[6] = {4, 3, 1, 2, 0, 5};

// ---- RNG (deterministic, seedable) ------------------------------------------
struct Rng {
    uint64_t s;
    explicit Rng(uint64_t seed) : s(seed ? seed : 0x9E3779B97F4A7C15ull) {}
    uint64_t next() { // xorshift64*
        s ^= s >> 12; s ^= s << 25; s ^= s >> 27;
        return s * 0x2545F4914F6CDD1Dull;
    }
    int range(int n) { return n <= 0 ? 0 : (int)(next() % (uint64_t)n); }
};

// ---- Game --------------------------------------------------------------------
class Game {
public:
    // Board size is the BASE (white / 2-player) radius. The official 2-player
    // area is radius 5 — six hexes on a side, 11 across. The full physical board
    // adds two rings on top, reserved for 3- and 4-player games.
    static constexpr int MIN_RADIUS = 3;
    static constexpr int MAX_RADIUS = 6;
    static constexpr int STANDARD_RADIUS = 5;   // official 2-player area: side 6, 11 across

    // Active play radius for a player count, given the base (white) radius:
    // 2p (and solitaire) use the white region; 3p adds a ring; 4p adds two.
    static int activeRadiusFor(int numPlayers, int base) {
        if (numPlayers <= 2) return base;
        return numPlayers == 3 ? base + 1 : base + 2;
    }

    // boardRadius <= 0 uses the official size; otherwise an explicit base radius
    // (clamped to [MIN_RADIUS, MAX_RADIUS]).
    Game(int numPlayers, uint64_t seed, int boardRadius = 0)
        : numPlayers_(std::clamp(numPlayers, 1, 4)), rng_(seed), seed_(seed) {
        solitaire_ = (numPlayers_ == 1);
        rackSize_  = solitaire_ ? 1 : 6;
        cap_       = solitaire_ ? 36 : 18;       // solitaire uses a double-length board
        baseRadius_   = boardRadius > 0 ? std::clamp(boardRadius, MIN_RADIUS, MAX_RADIUS) : STANDARD_RADIUS;
        activeRadius_ = activeRadiusFor(numPlayers_, baseRadius_);
        fullRadius_   = baseRadius_ + 2;         // full board = white + the two reserved rings
        setup();
    }

    // --- accessors ---
    int numPlayers() const { return numPlayers_; }
    int regionRadius() const { return fullRadius_; }  // full board radius (rendered extent)
    int activeRadius() const { return activeRadius_; } // playable region for this game
    int cap() const { return cap_; }
    bool solitaire() const { return solitaire_; }
    int current() const { return current_; }
    int pendingBonus() const { return pendingBonus_; }
    bool finished() const { return finished_; }
    int bagCount() const { return (int)bag_.size(); }
    uint64_t seed() const { return seed_; }
    bool firstRound() const { int n=0; for(int i=0;i<numPlayers_;++i) n+=firstDone_[i]?1:0; return n<numPlayers_; }

    // The six printed corners (q, r, color) for the current board size.
    std::vector<std::array<int,3>> printedCorners() const { return corners_; }

    int8_t cellAt(int q, int r) const {
        if (std::abs(q) > OFF || std::abs(r) > OFF) return NONEXIST;
        return board_[encode(q, r)];
    }
    const std::vector<std::array<int,2>>& hand(int p) const { return hands_[p]; }
    int score(int p, int c) const { return scores_[p][c]; }

    // All playable cells (for rendering), as (q,r) pairs.
    std::vector<std::array<int,2>> cells() const {
        std::vector<std::array<int,2>> out;
        for (int q = -fullRadius_; q <= fullRadius_; ++q)
            for (int r = -fullRadius_; r <= fullRadius_; ++r)
                if (cellAt(q, r) != NONEXIST) out.push_back({q, r});
        return out;
    }

    // --- move generation ---
    std::vector<Move> legalMoves() const {
        std::vector<Move> out;
        if (finished_) return out;
        const auto& h = hands_[current_];
        for (int t = 0; t < (int)h.size(); ++t) {
            bool sameColor = (h[t][0] == h[t][1]);
            for (int q = -fullRadius_; q <= fullRadius_; ++q)
                for (int r = -fullRadius_; r <= fullRadius_; ++r) {
                    if (cellAt(q, r) != EMPTY) continue;
                    for (int d = 0; d < 6; ++d) {
                        int nq = q + DIRS[d][0], nr = r + DIRS[d][1];
                        if (cellAt(nq, nr) != EMPTY) continue;
                        int flips = sameColor ? 1 : 2;
                        for (int f = 0; f < flips; ++f) {
                            Move m{t, q, r, d, f};
                            if (firstMoveOk(m)) out.push_back(m);
                        }
                    }
                }
        }
        return out;
    }

    bool isLegal(const Move& m) const {
        if (finished_) return false;
        const auto& h = hands_[current_];
        if (m.tileIndex < 0 || m.tileIndex >= (int)h.size()) return false;
        if (m.dir < 0 || m.dir >= 6) return false;
        if (cellAt(m.q, m.r) != EMPTY) return false;
        int nq = m.q + DIRS[m.dir][0], nr = m.r + DIRS[m.dir][1];
        if (cellAt(nq, nr) != EMPTY) return false;
        return firstMoveOk(m);
    }

    // --- apply a move ---
    MoveResult applyMove(const Move& m) {
        MoveResult res;
        if (!isLegal(m)) return res;
        res.ok = true;

        const auto tile = hands_[current_][m.tileIndex];
        int ca = m.flip ? tile[1] : tile[0];        // color at anchor
        int cb = m.flip ? tile[0] : tile[1];        // color at partner
        int aq = m.q, ar = m.r;
        int bq = m.q + DIRS[m.dir][0], br = m.r + DIRS[m.dir][1];

        // First-round bookkeeping: claim the printed corner we played next to.
        if (!firstDone_[current_]) {
            claimAdjacentCorner(aq, ar, bq, br);
            firstDone_[current_] = true;
        }

        // Place the two halves.
        board_[encode(aq, ar)] = (int8_t)ca;
        board_[encode(bq, br)] = (int8_t)cb;

        // Score each half over its five outward lines (excluding the partner dir).
        int gain[6] = {0,0,0,0,0,0};
        gain[ca] += scoreFrom(aq, ar, ca, m.dir);
        gain[cb] += scoreFrom(bq, br, cb, opposite(m.dir));

        for (int c = 0; c < 6; ++c) {
            if (gain[c] <= 0) continue;
            res.deltas.push_back({c, gain[c]});
            int before = scores_[current_][c];
            int after = std::min(cap_, before + gain[c]);
            scores_[current_][c] = after;
            // "Ingenious!" — reaching the cap grants a bonus play (standard game only).
            if (before < cap_ && after >= cap_ && !solitaire_) {
                res.ingenious++;
                pendingBonus_++;
            }
        }

        // Remove the played tile from the rack.
        hands_[current_].erase(hands_[current_].begin() + m.tileIndex);

        // Instant win: all six counters maxed.
        if (allMaxed(current_)) { finished_ = true; res.gameOver = true; return res; }

        if (pendingBonus_ > 0 && hasAnyMove()) {
            pendingBonus_--;                 // consume one; player places again
            res.bonusPending = true;
            return res;
        }
        pendingBonus_ = 0;

        refresh(current_);
        advance();
        res.turnEnded = true;
        res.gameOver = finished_;
        return res;
    }

    // Swap: allowed only if the rack holds none of the player's lowest color(s).
    bool canSwap() const {
        if (finished_ || solitaire_ || bag_.empty()) return false;
        int lo = lowestValue(current_);
        bool need[6]; for (int c=0;c<6;++c) need[c] = (scores_[current_][c]==lo);
        for (auto& tl : hands_[current_]) if (need[tl[0]] || need[tl[1]]) return false;
        return true;
    }
    bool swap() {
        if (!canSwap()) return false;
        for (auto& tl : hands_[current_]) bag_.push_back(tl);
        hands_[current_].clear();
        shuffleBag();
        refresh(current_);
        pendingBonus_ = 0;
        advance();
        return true;
    }

    // Pass: only when there is genuinely no move and no swap available.
    bool pass() {
        if (finished_ || !legalMoves().empty() || canSwap()) return false;
        pendingBonus_ = 0;
        advance();
        return true;
    }

    bool hasAnyMove() const { return !legalMoves().empty(); }

    // --- results ---
    int playerScore(int p) const { return lowestValue(p); }   // result = lowest counter
    // Ranking key: sorted-ascending counter values compared lexicographically,
    // higher is better. Returns players sorted best-first.
    std::vector<int> ranking() const {
        std::vector<int> order(numPlayers_);
        for (int i = 0; i < numPlayers_; ++i) order[i] = i;
        std::sort(order.begin(), order.end(), [&](int a, int b){
            auto va = sortedScores(a), vb = sortedScores(b);
            return va > vb; // lexicographic: better lowest, then next, ...
        });
        return order;
    }

    // ---- AI -----------------------------------------------------------------
    // level 0: greedy 1-ply.  level 1: 1-ply + opponent-denial lookahead heuristic.
    Move aiMove(int level) const {
        auto moves = legalMoves();
        Move best{-1,0,0,0,0};
        double bestVal = -1e18;
        uint64_t tie = rng_.s; // deterministic tie-break stream
        for (auto& m : moves) {
            double v = evaluate(m, level, tie);
            if (v > bestVal) { bestVal = v; best = m; }
        }
        return best;
    }

private:
    // ---- internal state ----
    int numPlayers_, rackSize_, cap_, baseRadius_, fullRadius_, activeRadius_;
    bool solitaire_ = false, finished_ = false;
    int current_ = 0, pendingBonus_ = 0;
    mutable Rng rng_;
    uint64_t seed_;
    int8_t board_[NCELL];
    std::vector<std::array<int,2>> bag_;
    std::vector<std::array<int,2>> hands_[4];
    int scores_[4][6] = {{0}};
    bool firstDone_[4] = {false,false,false,false};
    bool cornerClaimed_[6] = {false,false,false,false,false,false};
    std::vector<std::array<int,3>> corners_;   // (q, r, color) printed corners

    // ---- setup ----
    void setup() {
        std::fill(std::begin(board_), std::end(board_), NONEXIST);
        // Build the full hexagon; cells beyond the active region are reserved
        // (rendered but not playable for this player count).
        for (int q = -fullRadius_; q <= fullRadius_; ++q)
            for (int r = -fullRadius_; r <= fullRadius_; ++r) {
                int d = hexDist(q, r);
                if (d <= activeRadius_)      board_[encode(q, r)] = EMPTY;
                else if (d <= fullRadius_)   board_[encode(q, r)] = INACTIVE;
            }
        // Printed symbols sit at the corners of the white (inner) region.
        const int cornerR = baseRadius_;
        corners_.clear();
        for (int i = 0; i < 6; ++i) {
            int cq = CORNER_DIR[i][0] * cornerR;
            int cr = CORNER_DIR[i][1] * cornerR;
            corners_.push_back({cq, cr, CORNER_COLORS[i]});
            board_[encode(cq, cr)] = (int8_t)CORNER_COLORS[i];
        }

        buildBag();
        shuffleBag();
        for (int p = 0; p < numPlayers_; ++p) refresh(p);
    }

    void buildBag() {
        bag_.clear();
        for (int a = 0; a < 6; ++a)
            for (int b = a; b < 6; ++b) {
                int copies = (a == b) ? 5 : 6;   // 6*5 + 15*6 = 120 tiles
                for (int k = 0; k < copies; ++k) bag_.push_back({a, b});
            }
    }
    void shuffleBag() {
        for (int i = (int)bag_.size() - 1; i > 0; --i) std::swap(bag_[i], bag_[rng_.range(i + 1)]);
    }
    void refresh(int p) {
        while ((int)hands_[p].size() < rackSize_ && !bag_.empty()) {
            hands_[p].push_back(bag_.back());
            bag_.pop_back();
        }
    }

    // ---- turn flow ----
    void advance() {
        if (!boardHasSpace()) { finished_ = true; return; }
        if (solitaire_) {
            // single player keeps drawing; end when nothing can be placed
            if (hands_[0].empty() || legalMoves().empty()) finished_ = true;
            return;
        }
        // Skip players who can neither place nor swap; if everyone is stuck, end.
        for (int tries = 0; tries < numPlayers_; ++tries) {
            current_ = (current_ + 1) % numPlayers_;
            pendingBonus_ = 0;
            if (!legalMoves().empty() || canSwap()) return;
        }
        finished_ = true;
    }

    // ---- scoring ----
    int opposite(int d) const { return (d + 3) % 6; }

    int scoreFrom(int q, int r, int color, int excludeDir) const {
        int total = 0;
        for (int d = 0; d < 6; ++d) {
            if (d == excludeDir) continue;        // the partner half — not a line
            int cq = q + DIRS[d][0], cr = r + DIRS[d][1];
            while (cellAt(cq, cr) == color) {     // count matching, stop at empty/diff/edge
                total++;
                cq += DIRS[d][0]; cr += DIRS[d][1];
            }
        }
        return total;
    }

    // ---- helpers ----
    bool boardHasSpace() const {
        for (int q = -fullRadius_; q <= fullRadius_; ++q)
            for (int r = -fullRadius_; r <= fullRadius_; ++r) {
                if (cellAt(q, r) != EMPTY) continue;
                for (int d = 0; d < 6; ++d)
                    if (cellAt(q + DIRS[d][0], r + DIRS[d][1]) == EMPTY) return true;
            }
        return false;
    }

    int lowestValue(int p) const {
        int lo = cap_;
        for (int c = 0; c < 6; ++c) lo = std::min(lo, scores_[p][c]);
        return lo;
    }
    std::array<int,6> sortedScores(int p) const {
        std::array<int,6> v;
        for (int c = 0; c < 6; ++c) v[c] = scores_[p][c];
        std::sort(v.begin(), v.end());
        return v;
    }
    bool allMaxed(int p) const {
        for (int c = 0; c < 6; ++c) if (scores_[p][c] < cap_) return false;
        return true;
    }

    // First-round rule: a player's first tile must touch a printed corner that no
    // one else has claimed yet.
    bool firstMoveOk(const Move& m) const {
        if (firstDone_[current_]) return true;
        int bq = m.q + DIRS[m.dir][0], br = m.r + DIRS[m.dir][1];
        for (int i = 0; i < (int)corners_.size(); ++i) {
            if (cornerClaimed_[i]) continue;
            int cq = corners_[i][0], cr = corners_[i][1];
            if (adjacent(m.q, m.r, cq, cr) || adjacent(bq, br, cq, cr)) return true;
        }
        return false;
    }
    void claimAdjacentCorner(int aq, int ar, int bq, int br) {
        for (int i = 0; i < (int)corners_.size(); ++i) {
            if (cornerClaimed_[i]) continue;
            int cq = corners_[i][0], cr = corners_[i][1];
            if (adjacent(aq, ar, cq, cr) || adjacent(bq, br, cq, cr)) {
                cornerClaimed_[i] = true; return;
            }
        }
    }
    static bool adjacent(int q1, int r1, int q2, int r2) {
        for (int d = 0; d < 6; ++d)
            if (q1 + DIRS[d][0] == q2 && r1 + DIRS[d][1] == r2) return true;
        return false;
    }

    // ---- AI evaluation ----
    // Score a candidate move on a scratch copy, valuing balanced progress (the
    // weakest colors matter most because the result is the lowest counter).
    double evaluate(const Move& m, int level, uint64_t& tie) const {
        Game g = *this;                      // cheap value copy
        int me = current_;
        int before[6]; for (int c=0;c<6;++c) before[c]=g.scores_[me][c];
        g.applyMoveRaw(m);
        int after[6];  for (int c=0;c<6;++c) after[c]=g.scores_[me][c];

        double val = 0;
        int lo = cap_; for (int c=0;c<6;++c) lo = std::min(lo, before[c]);
        for (int c = 0; c < 6; ++c) {
            int gain = after[c] - before[c];
            if (gain <= 0) continue;
            // weight low colors much more; diminishing returns near the cap
            double scarcity = 1.0 + (double)(cap_ - before[c]) / cap_ * 2.0;
            double lowBoost = (before[c] == lo) ? 2.5 : 1.0;
            val += gain * scarcity * lowBoost;
        }
        // small bonus for reaching the cap (free Ingenious play)
        for (int c = 0; c < 6; ++c) if (before[c] < cap_ && after[c] >= cap_) val += 6.0;

        if (level >= 1) {
            // mild denial term: prefer leaving fewer huge openings for the next player
            val -= 0.15 * g.bestOpponentGain();
        }
        // deterministic jitter for tie-breaking variety
        tie ^= tie << 13; tie ^= tie >> 7; tie ^= tie << 17;
        val += (double)(tie % 1000) / 1e6;
        return val;
    }
    // apply without the bonus/turn machinery — used only inside evaluate()
    void applyMoveRaw(const Move& m) {
        const auto tile = hands_[current_][m.tileIndex];
        int ca = m.flip ? tile[1] : tile[0];
        int cb = m.flip ? tile[0] : tile[1];
        int aq=m.q, ar=m.r, bq=m.q+DIRS[m.dir][0], br=m.r+DIRS[m.dir][1];
        board_[encode(aq,ar)] = (int8_t)ca;
        board_[encode(bq,br)] = (int8_t)cb;
        scores_[current_][ca] = std::min(cap_, scores_[current_][ca] + scoreFrom(aq,ar,ca,m.dir));
        scores_[current_][cb] = std::min(cap_, scores_[current_][cb] + scoreFrom(bq,br,cb,opposite(m.dir)));
    }
    int bestOpponentGain() const {
        // upper bound on a single placement's raw points, ignoring whose turn
        int best = 0;
        for (int q=-fullRadius_;q<=fullRadius_;++q)
          for (int r=-fullRadius_;r<=fullRadius_;++r) {
            if (cellAt(q,r)!=EMPTY) continue;
            for (int d=0; d<6; ++d) {
                int nq=q+DIRS[d][0], nr=r+DIRS[d][1];
                if (cellAt(nq,nr)!=EMPTY) continue;
                for (int c=0;c<6;++c) {
                    int g = scoreFrom(q,r,c,d) + scoreFrom(nq,nr,c,opposite(d));
                    best = std::max(best, g);
                }
            }
          }
        return best;
    }
};

} // namespace ing
