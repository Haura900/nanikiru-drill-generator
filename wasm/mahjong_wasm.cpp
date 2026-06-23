#include <chrono>
#include <numeric>
#include <stdexcept>
#include <string>

#include <emscripten/bind.h>
#include <rapidjson/document.h>
#include <rapidjson/stringbuffer.h>
#include <rapidjson/writer.h>

#include "mahjong/mahjong.hpp"

using namespace mahjong;

namespace
{
std::string stringify(const rapidjson::Document &doc)
{
    rapidjson::StringBuffer buffer;
    rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
    doc.Accept(writer);
    return buffer.GetString();
}

void add_probability_array(rapidjson::Value &object, const char *name,
                           const std::vector<double> &values,
                           rapidjson::Document::AllocatorType &allocator)
{
    rapidjson::Value array(rapidjson::kArrayType);
    for (double value : values) {
        array.PushBack(value, allocator);
    }
    object.AddMember(rapidjson::StringRef(name), array, allocator);
}

std::string analyze_json(const std::string &input)
{
    rapidjson::Document request;
    request.Parse(input.c_str());
    if (request.HasParseError() || !request.IsObject()) {
        throw std::runtime_error("Invalid JSON request.");
    }

    Round round;
    round.wind = request["round_wind"].GetInt();
    for (const auto &tile : request["dora_indicators"].GetArray()) {
        round.dora_indicators.push_back(tile.GetInt());
    }

    Player player;
    player.wind = request["seat_wind"].GetInt();
    std::vector<int> hand;
    for (const auto &tile : request["hand"].GetArray()) {
        hand.push_back(tile.GetInt());
    }
    player.hand = from_array(hand);
    for (const auto &item : request["melds"].GetArray()) {
        std::vector<int> tiles;
        for (const auto &tile : item["tiles"].GetArray()) {
            tiles.push_back(tile.GetInt());
        }
        player.melds.emplace_back(item["type"].GetInt(), tiles);
    }

    ExpectedScoreCalculator::Config config;
    config.enable_reddora = request["enable_reddora"].GetBool();
    config.enable_uradora = request["enable_uradora"].GetBool();
    config.enable_shanten_down = request["enable_shanten_down"].GetBool();
    config.enable_tegawari = request["enable_tegawari"].GetBool();
    config.objective = static_cast<ExpectedScoreCalculator::Objective>(
        request["objective"].GetInt());
    config.t_min = 1;
    config.t_max = 18;
    config.extra = 1;
    config.shanten_type = ShantenFlag::All;

    const MergedCount wall = create_wall(round, player, config.enable_reddora);
    config.sum = std::accumulate(wall.begin(), wall.begin() + 34, 0);

    const int shanten = std::get<1>(
        ShantenCalculator::calc(player.hand, player.num_melds(), ShantenFlag::All));
    const int regular = std::get<1>(
        ShantenCalculator::calc(player.hand, player.num_melds(), ShantenFlag::Regular));
    const int seven_pairs = std::get<1>(
        ShantenCalculator::calc(player.hand, player.num_melds(), ShantenFlag::SevenPairs));
    const int thirteen_orphans = std::get<1>(
        ShantenCalculator::calc(player.hand, player.num_melds(), ShantenFlag::ThirteenOrphans));
    config.calc_stats = shanten <= 3;
    if (shanten == -1) {
        throw std::runtime_error("The hand is already complete.");
    }

    const auto started = std::chrono::steady_clock::now();
    auto [stats, searched] = ExpectedScoreCalculator::calc(config, round, player, wall);
    const auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::steady_clock::now() - started).count();

    rapidjson::Document response(rapidjson::kObjectType);
    auto &allocator = response.GetAllocator();
    response.AddMember("success", true, allocator);
    response.AddMember("searched", searched, allocator);
    response.AddMember("time", elapsed, allocator);

    rapidjson::Value shanten_value(rapidjson::kObjectType);
    shanten_value.AddMember("all", shanten, allocator);
    shanten_value.AddMember("regular", regular, allocator);
    shanten_value.AddMember("seven_pairs", seven_pairs, allocator);
    shanten_value.AddMember("thirteen_orphans", thirteen_orphans, allocator);
    response.AddMember("shanten", shanten_value, allocator);

    rapidjson::Value stats_value(rapidjson::kArrayType);
    for (const auto &stat : stats) {
        rapidjson::Value item(rapidjson::kObjectType);
        item.AddMember("tile", stat.tile, allocator);
        item.AddMember("shanten", stat.shanten, allocator);
        add_probability_array(item, "tenpai_prob", stat.tenpai_prob, allocator);
        add_probability_array(item, "win_prob", stat.win_prob, allocator);
        add_probability_array(item, "exp_score", stat.exp_score, allocator);
        rapidjson::Value necessary(rapidjson::kArrayType);
        for (const auto &[tile, count] : stat.necessary_tiles) {
            rapidjson::Value value(rapidjson::kObjectType);
            value.AddMember("tile", tile, allocator);
            value.AddMember("count", count, allocator);
            necessary.PushBack(value, allocator);
        }
        item.AddMember("necessary_tiles", necessary, allocator);
        stats_value.PushBack(item, allocator);
    }
    response.AddMember("stats", stats_value, allocator);
    return stringify(response);
}
} // namespace

EMSCRIPTEN_BINDINGS(mahjong_wasm)
{
    emscripten::function("analyzeJson", &analyze_json);
}

