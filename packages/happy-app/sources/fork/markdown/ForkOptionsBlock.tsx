import * as React from 'react';
import { Pressable, View } from 'react-native';
import { AnimatedMarkdownText } from './AnimatedMarkdownText';
import { optionCardStyles as style } from './optionCardStyles';

/**
 * FORK PATCH: [RESTORE-R8d] 8a e-ink option-card renderer (invariant HA-8).
 *
 * Upstream renders each option as a plain `<Text>` inside a bordered card. The
 * fork adds the left accent bar (`optionItemAccent`) and routes the label
 * through `AnimatedMarkdownText` so it tracks the chat font scale. The e-ink
 * visual tuning lives in ./optionCardStyles.
 *
 * Behavior-preserving relocation of the inline `RenderOptionsBlock` that used to
 * live in components/markdown/MarkdownView.tsx. See docs/happy-patch-surface.md (HA-8).
 *
 * `onOptionPress` uses a structural `{ title: string }` param (identical to the
 * canonical `Option` type) to avoid importing back from MarkdownView.
 */
export function ForkOptionsBlock(props: {
    items: string[],
    first: boolean,
    last: boolean,
    selectable: boolean,
    onOptionPress?: (option: { title: string }) => void
}) {
    return (
        <View style={[style.optionsContainer, props.first && style.first, props.last && style.last]}>
            {props.items.map((item, index) => {
                if (props.onOptionPress) {
                    return (
                        <Pressable
                            key={index}
                            style={({ pressed }) => [
                                style.optionItem,
                                pressed && style.optionItemPressed
                            ]}
                            onPress={() => props.onOptionPress?.({ title: item })}
                        >
                            <View style={style.optionItemAccent} />
                            <AnimatedMarkdownText selectable={props.selectable} baseStyle={style.optionText}>{item}</AnimatedMarkdownText>
                        </Pressable>
                    );
                } else {
                    return (
                        <View key={index} style={style.optionItem}>
                            <View style={style.optionItemAccent} />
                            <AnimatedMarkdownText selectable={props.selectable} baseStyle={style.optionText}>{item}</AnimatedMarkdownText>
                        </View>
                    );
                }
            })}
        </View>
    );
}
