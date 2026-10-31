import { computed } from '@rivetjs/reactivity';
import { For, Show } from '@rivetjs/runtime/dom';
import { Card } from '@rivetjs/ui/card';
import { Chip } from '@rivetjs/ui/chip';
import { Skeleton } from '@rivetjs/ui/skeleton';
import { Separator } from '@rivetjs/ui/separator';
import { DescriptionList } from '@rivetjs/ui/description-list';
import type { Snapshot } from 'tetra-stream';
import { readNestedProfile, type NestedStatus, type NestedText } from './nested-profile.ts';

/** Nested object/array values use their source pointers and their own completion states. */
export function NestedProfileCard(props: { snapshot: () => Snapshot<unknown> }) {
  const profile = computed(() => readNestedProfile(props.snapshot()));
  function Badge(props: { status: NestedStatus; label: string }) {
    return (
      <Chip
        size="sm"
        variant="soft"
        color={
          props.status === 'complete'
            ? 'success'
            : props.status === 'partial'
              ? 'warning'
              : 'default'
        }
        aria-label={`${props.label}: ${props.status}`}
      >
        {props.status === 'missing'
          ? 'Not included'
          : props.status === 'pending'
            ? 'Pending'
            : props.status === 'partial'
              ? 'Partial'
              : 'Complete'}
      </Chip>
    );
  }
  function Text(props: { field: NestedText }) {
    return (
      <Show
        when={props.field.value !== undefined}
        fallback={() => (
          <Show
            when={props.field.status === 'pending'}
            fallback={<span class="missing-value">Not included</span>}
          >
            <Skeleton
              render={(attributes) => <span {...attributes} />}
              class="nested-text-placeholder"
              aria-label={`Waiting for ${props.field.path}`}
            />
          </Show>
        )}
      >
        <span
          class={props.field.status === 'partial' ? 'is-writing' : ''}
          data-nested-path={props.field.path}
          data-completion={props.field.status}
        >
          {props.field.value}
        </span>
      </Show>
    );
  }
  return (
    <Show when={profile().supported}>
      <Separator class="profile-divider" />
      <section class="nested-contact" aria-label="Nested contact object">
        <div class="field-label">
          <h4>
            Contact <code>object</code>
          </h4>
          <Badge status={profile().contactStatus} label="Contact object" />
        </div>
        <DescriptionList class="nested-contact-details">
          <DescriptionList.Item>
            <DescriptionList.Term>Email</DescriptionList.Term>
            <DescriptionList.Details>
              <span class="nested-detail">
                <Text field={profile().email} />
                <Badge status={profile().email.status} label="Contact email" />
              </span>
            </DescriptionList.Details>
          </DescriptionList.Item>
          <DescriptionList.Item>
            <DescriptionList.Term>
              Socials <code>array</code>
            </DescriptionList.Term>
            <DescriptionList.Details>
              <Show
                when={profile().socials.length > 0}
                fallback={() => (
                  <Show
                    when={
                      profile().socialsStatus === 'pending' || profile().socialsStatus === 'partial'
                    }
                    fallback={
                      <span class="missing-value">
                        {profile().socialsStatus === 'complete'
                          ? 'No social accounts.'
                          : 'Not included'}
                      </span>
                    }
                  >
                    <Skeleton
                      class="nested-text-placeholder"
                      aria-label="Waiting for social accounts"
                    />
                  </Show>
                )}
              >
                <For each={() => profile().socials} by={(social) => social.sourceIndex}>
                  {(social) => (
                    <div class="nested-social">
                      <span>{social().network.value ?? 'Account'}:</span>
                      <Text field={social().handle} />
                      <Badge status={social().handle.status} label="Social handle" />
                    </div>
                  )}
                </For>
              </Show>
            </DescriptionList.Details>
          </DescriptionList.Item>
        </DescriptionList>
        <code class="nested-path">{profile().email.path}</code>
      </section>
      <Separator class="profile-divider" />
      <section class="nested-projects" aria-label="Nested projects array">
        <div class="field-label">
          <h4>
            Projects <code>array of objects</code>
          </h4>
          <Badge status={profile().projectsStatus} label="Projects array" />
        </div>
        <div class="nested-project-list" id="profile-projects">
          <Show
            when={profile().projects.length > 0}
            fallback={() => (
              <Show
                when={
                  profile().projectsStatus === 'pending' || profile().projectsStatus === 'partial'
                }
                fallback={<p class="missing-value">No projects included.</p>}
              >
                <Card variant="secondary">
                  <Card.Content>
                    <Skeleton
                      class="nested-text-placeholder"
                      aria-label="Waiting for the first project"
                    />
                    <Skeleton class="nested-summary-placeholder" />
                    <code class="nested-path">/projects/0/details/stack</code>
                  </Card.Content>
                </Card>
              </Show>
            )}
          >
            <For each={() => profile().projects} by={(project) => project.sourceIndex}>
              {(project) => (
                <Card
                  variant="secondary"
                  class="profile-project"
                  data-project-index={project().sourceIndex}
                  data-completion={project().status}
                >
                  <Card.Header class="nested-project-header">
                    <Card.Title>
                      <Text field={project().name} />
                    </Card.Title>
                    <Badge
                      status={project().status}
                      label={`Project ${project().sourceIndex + 1} object`}
                    />
                  </Card.Header>
                  <Card.Content>
                    <Card.Description>
                      <Text field={project().summary} />
                    </Card.Description>
                    <div class="nested-stack-heading">
                      <span>
                        Stack <code>array</code>
                      </span>
                      <Badge
                        status={project().stackStatus}
                        label={`Project ${project().sourceIndex + 1} stack array`}
                      />
                    </div>
                    <Show
                      when={project().stack.length > 0}
                      fallback={() => (
                        <Show
                          when={
                            project().stackStatus === 'pending' ||
                            project().stackStatus === 'partial'
                          }
                          fallback={
                            <span class="missing-value">
                              {project().stackStatus === 'complete'
                                ? 'Empty stack.'
                                : 'Stack not included'}
                            </span>
                          }
                        >
                          <Skeleton
                            class="nested-text-placeholder"
                            aria-label="Waiting for project stack"
                          />
                        </Show>
                      )}
                    >
                      <div class="nested-stack">
                        <For each={() => project().stack} by={(item) => item.sourceIndex}>
                          {(item) => (
                            <Chip
                              size="sm"
                              variant="soft"
                              color={item().status === 'partial' ? 'warning' : 'success'}
                              title={`${item().path}: ${item().status}`}
                              aria-label={`${item().value}: ${item().status}`}
                              data-nested-path={item().path}
                              data-completion={item().status}
                            >
                              {item().value}
                            </Chip>
                          )}
                        </For>
                      </div>
                    </Show>
                    <code class="nested-path">
                      {project().path}/details/stack
                      {project().stack.length ? `/${project().stack.at(-1)!.sourceIndex}` : ''}
                    </code>
                  </Card.Content>
                </Card>
              )}
            </For>
          </Show>
        </div>
      </section>
    </Show>
  );
}
