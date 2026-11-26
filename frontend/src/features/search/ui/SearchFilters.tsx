import { Box, Chip, MenuItem, Stack, TextField } from "@mui/material";
import { useEffect, useState } from "react";
import { useLibraries } from "entities/library/model";
import {
  SEARCH_TYPES,
  searchYears,
  type SearchFilters as Filters,
} from "../model/searchResults";

export function SearchFilters({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (key: keyof Filters, value: string) => void;
}) {
  const libraries = useLibraries();
  const [year, setYear] = useState(filters.year);
  useEffect(() => setYear(filters.year), [filters.year]);
  const valid = !year || Boolean(searchYears(year));
  const commitYear = () => {
    if (valid && year !== filters.year) onChange("year", year.trim());
  };
  return (
    <Stack spacing={1.5}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 10rem), 1fr))",
          maxWidth: "48rem",
          gap: 1.5,
        }}
      >
        <TextField
          select
          label="Type"
          size="small"
          value={filters.type}
          onChange={(event) => onChange("type", event.target.value)}
        >
          {Object.entries(SEARCH_TYPES).map(([type, title]) => (
            <MenuItem key={type} value={type}>
              {title}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Library"
          size="small"
          value={filters.library || "all"}
          onChange={(event) =>
            onChange(
              "library",
              event.target.value === "all" ? "" : event.target.value,
            )
          }
        >
          <MenuItem value="all">All libraries</MenuItem>
          {filters.library &&
            !libraries.data?.some((item) => item.key === filters.library) && (
              <MenuItem value={filters.library}>
                Library {filters.library}
              </MenuItem>
            )}
          {libraries.data?.map((item) => (
            <MenuItem key={item.key} value={item.key}>
              {item.title}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Year"
          placeholder="2021 or 1980–1989"
          size="small"
          value={year}
          error={!valid}
          helperText={
            !valid ? "Enter a year or an ascending range." : undefined
          }
          onChange={(event) => setYear(event.target.value)}
          onBlur={commitYear}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitYear();
            }
          }}
          sx={{ gridColumn: { xs: "1 / -1", sm: "auto" } }}
        />
      </Box>
      <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: "wrap" }}>
        {filters.type !== "all" && (
          <Chip
            size="small"
            label={SEARCH_TYPES[filters.type]}
            onDelete={() => onChange("type", "all")}
          />
        )}
        {filters.library && (
          <Chip
            size="small"
            label={
              libraries.data?.find((item) => item.key === filters.library)
                ?.title ?? `Library ${filters.library}`
            }
            onDelete={() => onChange("library", "")}
          />
        )}
        {filters.year && (
          <Chip
            size="small"
            label={filters.year}
            onDelete={() => onChange("year", "")}
          />
        )}
      </Stack>
    </Stack>
  );
}
